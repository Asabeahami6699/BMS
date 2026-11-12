import { create } from "zustand";
import {
  defaultRegistrationFormSetup,
  parseApprovalWorkflow,
  type ApprovalWorkflow,
  type RegistrationFormSetup
} from "@bms/shared";
import type { CompanyProfile, MessageLogItem, TenantSmsSettings } from "../api";
import {
  getApprovalWorkflow,
  getCompanyProfile,
  getMessageLog,
  getRegistrationFormSetup,
  getSmsPlatformStatus,
  getTenantId,
  getTenantSmsSettings,
  updateApprovalWorkflow,
  updateCompanyProfile,
  updateRegistrationFormSetup,
  updateTenantSmsSettings
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import type { RegistrationFormPrintContext } from "../registrationFormPrint";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type SettingsWorkspaceSection =
  | "approvalWorkflow"
  | "companyProfile"
  | "formSetup"
  | "notifications";

type SectionStatus = {
  loading: boolean;
  lastFetchedAt: number | null;
  error: string | null;
};

type NotificationsChannels = {
  hasSms: boolean;
  hasEmail: boolean;
};

type SettingsWorkspaceState = {
  approvalWorkflow: ApprovalWorkflow;
  companyProfile: CompanyProfile | null;
  formSetup: RegistrationFormSetup;
  formSetupPrintContext: RegistrationFormPrintContext;
  openingFee: string;
  dailyAmounts: Record<string, string>;
  smsReady: boolean | null;
  smsSettings: TenantSmsSettings | null;
  messageLogItems: MessageLogItem[];
  messageLogReady: boolean;
  messageLogLoading: boolean;
  notificationsChannels: NotificationsChannels | null;

  section: Record<SettingsWorkspaceSection, SectionStatus>;
  savingApproval: boolean;
  savingCompanyProfile: boolean;
  savingFormSetup: boolean;
  savingNotifications: boolean;

  liveSyncActive: boolean;

  hydrateSection: (section: SettingsWorkspaceSection, options?: { force?: boolean }) => void;
  refreshSection: (section: SettingsWorkspaceSection) => Promise<void>;
  refreshSectionSilent: (section: SettingsWorkspaceSection) => Promise<void>;
  setNotificationsChannels: (channels: NotificationsChannels) => void;
  refreshMessageLog: () => Promise<void>;

  setApprovalWorkflow: (workflow: ApprovalWorkflow) => void;
  saveApprovalWorkflow: (workflow: ApprovalWorkflow) => Promise<ApprovalWorkflow>;

  setCompanyProfileDraft: (patch: Partial<CompanyProfile>) => void;
  saveCompanyProfile: (
    profile: Parameters<typeof updateCompanyProfile>[0]
  ) => Promise<CompanyProfile>;

  setFormSetup: (setup: RegistrationFormSetup) => void;
  setOpeningFee: (value: string) => void;
  setDailyAmounts: (
    value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)
  ) => void;
  saveFormSetup: (setup: RegistrationFormSetup) => Promise<RegistrationFormSetup>;

  setSmsSettings: (settings: TenantSmsSettings | null) => void;
  saveSmsSettings: (
    payload: Partial<
      Pick<TenantSmsSettings, "enabled" | "notifyDeposit" | "notifyWithdrawal" | "notifyDailySusu">
    > & { senderId?: string | null }
  ) => Promise<TenantSmsSettings>;

  startLiveSync: (section: SettingsWorkspaceSection) => void;
  stopLiveSync: () => void;
};

const sectionFetchInFlight: Partial<Record<SettingsWorkspaceSection, Promise<void> | null>> = {};
const sectionSnapshotKey: Partial<Record<SettingsWorkspaceSection, string>> = {};
const silentSchedulers: Record<SettingsWorkspaceSection, ReturnType<typeof createSilentRefreshScheduler>> = {
  approvalWorkflow: createSilentRefreshScheduler(),
  companyProfile: createSilentRefreshScheduler(),
  formSetup: createSilentRefreshScheduler(),
  notifications: createSilentRefreshScheduler()
};
const liveSync = createLiveSyncManager();

function emptySectionStatus(): SectionStatus {
  return { loading: false, lastFetchedAt: null, error: null };
}

function dailyAmountsFromSetup(setup: RegistrationFormSetup): Record<string, string> {
  return Object.fromEntries(
    setup.forms.map((form) => [form.id, form.defaultDailyContributionGhs.toFixed(2)])
  );
}

function printContextFromProfile(profile: CompanyProfile | null): RegistrationFormPrintContext {
  if (!profile) {
    return {};
  }
  return {
    companyName: profile.name,
    companyPhone: profile.phone,
    companyAddress: profile.address
  };
}

const LIVE_TABLES: Partial<Record<SettingsWorkspaceSection, string[]>> = {
  approvalWorkflow: ["tenant_approval_workflow"],
  companyProfile: ["tenants"],
  formSetup: ["tenant_registration_form_setup"],
  notifications: ["tenant_sms_settings", "message_outbox"]
};

export const useSettingsWorkspaceStore = create<SettingsWorkspaceState>((set, get) => ({
  approvalWorkflow: parseApprovalWorkflow(null),
  companyProfile: null,
  formSetup: defaultRegistrationFormSetup(),
  formSetupPrintContext: {},
  openingFee: "20.00",
  dailyAmounts: dailyAmountsFromSetup(defaultRegistrationFormSetup()),
  smsReady: null,
  smsSettings: null,
  messageLogItems: [],
  messageLogReady: true,
  messageLogLoading: false,
  notificationsChannels: null,

  section: {
    approvalWorkflow: emptySectionStatus(),
    companyProfile: emptySectionStatus(),
    formSetup: emptySectionStatus(),
    notifications: emptySectionStatus()
  },
  savingApproval: false,
  savingCompanyProfile: false,
  savingFormSetup: false,
  savingNotifications: false,
  liveSyncActive: false,

  setNotificationsChannels: (channels) => set({ notificationsChannels: channels }),

  setApprovalWorkflow: (workflow) => set({ approvalWorkflow: workflow }),

  setCompanyProfileDraft: (patch) => {
    const current = get().companyProfile;
    if (!current) {
      return;
    }
    set({ companyProfile: { ...current, ...patch } });
  },

  setFormSetup: (setup) => set({ formSetup: setup }),

  setOpeningFee: (value) => set({ openingFee: value }),

  setDailyAmounts: (value) =>
    set({
      dailyAmounts: typeof value === "function" ? value(get().dailyAmounts) : value
    }),

  setSmsSettings: (settings) => set({ smsSettings: settings }),

  hydrateSection: (section, options) => {
    const status = get().section[section];
    runHydrate({
      force: options?.force,
      loading: status.loading,
      lastFetchedAt: status.lastFetchedAt,
      refresh: () => get().refreshSection(section),
      refreshSilent: () => get().refreshSectionSilent(section),
      scheduleSilent: (run) => silentSchedulers[section].schedule(run)
    });
  },

  refreshSection: async (section) => {
    const inFlight = sectionFetchInFlight[section];
    if (inFlight) {
      set((state) => ({
        section: {
          ...state.section,
          [section]: { ...state.section[section], loading: true }
        }
      }));
      await inFlight;
      set((state) => ({
        section: {
          ...state.section,
          [section]: { ...state.section[section], loading: false }
        }
      }));
      return;
    }

    set((state) => ({
      section: {
        ...state.section,
        [section]: { ...state.section[section], loading: true, error: null }
      }
    }));

    const job = (async () => {
      try {
        if (section === "approvalWorkflow") {
          const loaded = await getApprovalWorkflow();
          const key = JSON.stringify(loaded);
          if (key !== sectionSnapshotKey.approvalWorkflow) {
            sectionSnapshotKey.approvalWorkflow = key;
            set({ approvalWorkflow: loaded });
          }
        } else if (section === "companyProfile") {
          const profile = await getCompanyProfile();
          const key = JSON.stringify(profile);
          if (key !== sectionSnapshotKey.companyProfile) {
            sectionSnapshotKey.companyProfile = key;
            set({ companyProfile: profile });
          }
        } else if (section === "formSetup") {
          const [loaded, profile] = await Promise.all([
            getRegistrationFormSetup(),
            getCompanyProfile().catch(() => null)
          ]);
          const key = JSON.stringify({ setup: loaded, profile });
          if (key !== sectionSnapshotKey.formSetup) {
            sectionSnapshotKey.formSetup = key;
            set({
              formSetup: loaded,
              openingFee: loaded.savingsOpeningFeeGhs.toFixed(2),
              dailyAmounts: dailyAmountsFromSetup(loaded),
              formSetupPrintContext: printContextFromProfile(profile)
            });
          }
        } else if (section === "notifications") {
          const channels = get().notificationsChannels ?? { hasSms: false, hasEmail: false };
          if (channels.hasSms) {
            const [platform, smsSettings] = await Promise.all([
              getSmsPlatformStatus(),
              getTenantSmsSettings()
            ]);
            const key = JSON.stringify({ platform, smsSettings });
            if (key !== sectionSnapshotKey.notifications) {
              sectionSnapshotKey.notifications = key;
              set({ smsReady: platform.configured, smsSettings });
            }
          }
          if (channels.hasSms || channels.hasEmail) {
            await get().refreshMessageLog();
          }
        }

        set((state) => ({
          section: {
            ...state.section,
            [section]: {
              ...state.section[section],
              lastFetchedAt: Date.now(),
              error: null
            }
          }
        }));
      } catch (error) {
        set((state) => ({
          section: {
            ...state.section,
            [section]: {
              ...state.section[section],
              error: toUserFacingError(error, `Failed to load ${section}`),
              lastFetchedAt: Date.now()
            }
          }
        }));
      } finally {
        set((state) => ({
          section: {
            ...state.section,
            [section]: { ...state.section[section], loading: false }
          }
        }));
        sectionFetchInFlight[section] = null;
      }
    })();

    sectionFetchInFlight[section] = job;
    await job;
  },

  refreshSectionSilent: async (section) => {
    const inFlight = sectionFetchInFlight[section];
    if (inFlight) {
      return inFlight;
    }
    const lastFetchedAt = get().section[section].lastFetchedAt;
    if (isFresh(lastFetchedAt)) {
      return;
    }

    const job = (async () => {
      try {
        if (section === "approvalWorkflow") {
          const loaded = await getApprovalWorkflow();
          const key = JSON.stringify(loaded);
          if (key !== sectionSnapshotKey.approvalWorkflow) {
            sectionSnapshotKey.approvalWorkflow = key;
            set({ approvalWorkflow: loaded });
          }
        } else if (section === "companyProfile") {
          const profile = await getCompanyProfile();
          const key = JSON.stringify(profile);
          if (key !== sectionSnapshotKey.companyProfile) {
            sectionSnapshotKey.companyProfile = key;
            set({ companyProfile: profile });
          }
        } else if (section === "formSetup") {
          const [loaded, profile] = await Promise.all([
            getRegistrationFormSetup(),
            getCompanyProfile().catch(() => null)
          ]);
          const key = JSON.stringify({ setup: loaded, profile });
          if (key !== sectionSnapshotKey.formSetup) {
            sectionSnapshotKey.formSetup = key;
            set({
              formSetup: loaded,
              openingFee: loaded.savingsOpeningFeeGhs.toFixed(2),
              dailyAmounts: dailyAmountsFromSetup(loaded),
              formSetupPrintContext: printContextFromProfile(profile)
            });
          }
        } else if (section === "notifications") {
          const channels = get().notificationsChannels ?? { hasSms: false, hasEmail: false };
          if (channels.hasSms) {
            const [platform, smsSettings] = await Promise.all([
              getSmsPlatformStatus(),
              getTenantSmsSettings()
            ]);
            const key = JSON.stringify({ platform, smsSettings });
            if (key !== sectionSnapshotKey.notifications) {
              sectionSnapshotKey.notifications = key;
              set({ smsReady: platform.configured, smsSettings });
            }
          }
          if (channels.hasSms || channels.hasEmail) {
            await get().refreshMessageLog();
          }
        }

        set((state) => ({
          section: {
            ...state.section,
            [section]: { ...state.section[section], lastFetchedAt: Date.now(), error: null }
          }
        }));
      } catch {
        /* keep cache */
      } finally {
        sectionFetchInFlight[section] = null;
      }
    })();

    sectionFetchInFlight[section] = job;
    return job;
  },

  refreshMessageLog: async () => {
    const channels = get().notificationsChannels ?? { hasSms: false, hasEmail: false };
    if (!channels.hasSms && !channels.hasEmail) {
      set({ messageLogLoading: false });
      return;
    }
    set({ messageLogLoading: true });
    try {
      const log = await getMessageLog();
      set({
        messageLogItems: log.items,
        messageLogReady: log.storageReady,
        messageLogLoading: false
      });
    } catch {
      set({ messageLogLoading: false });
    }
  },

  saveApprovalWorkflow: async (workflow) => {
    set({ savingApproval: true });
    try {
      const saved = await updateApprovalWorkflow(workflow);
      set({ approvalWorkflow: saved, savingApproval: false });
      sectionSnapshotKey.approvalWorkflow = JSON.stringify(saved);
      return saved;
    } catch (error) {
      set({ savingApproval: false });
      throw error;
    }
  },

  saveCompanyProfile: async (profile) => {
    set({ savingCompanyProfile: true });
    try {
      const saved = await updateCompanyProfile(profile);
      set({ companyProfile: saved, savingCompanyProfile: false });
      sectionSnapshotKey.companyProfile = JSON.stringify(saved);
      return saved;
    } catch (error) {
      set({ savingCompanyProfile: false });
      throw error;
    }
  },

  saveFormSetup: async (setup) => {
    set({ savingFormSetup: true });
    try {
      const saved = await updateRegistrationFormSetup(setup);
      set({
        formSetup: saved,
        openingFee: saved.savingsOpeningFeeGhs.toFixed(2),
        dailyAmounts: dailyAmountsFromSetup(saved),
        savingFormSetup: false
      });
      sectionSnapshotKey.formSetup = JSON.stringify({
        setup: saved,
        profile: get().formSetupPrintContext
      });
      return saved;
    } catch (error) {
      set({ savingFormSetup: false });
      throw error;
    }
  },

  saveSmsSettings: async (payload) => {
    set({ savingNotifications: true });
    try {
      const updated = await updateTenantSmsSettings(payload);
      set({ smsSettings: updated, savingNotifications: false });
      return updated;
    } catch (error) {
      set({ savingNotifications: false });
      throw error;
    }
  },

  startLiveSync: (section) => {
    if (get().liveSyncActive) {
      return;
    }
    const tables = LIVE_TABLES[section];
    if (!tables?.length) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables,
      onRefresh: () => void get().refreshSectionSilent(section),
      isStale: () => !isFresh(get().section[section].lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    for (const section of Object.keys(silentSchedulers) as SettingsWorkspaceSection[]) {
      silentSchedulers[section].clear();
    }
    set({ liveSyncActive: false });
  }
}));
