import { FormEvent, useEffect, useState } from "react";
import type { HrPolicies } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { useToast } from "../../../components/Toast";
import { useHrDeskStore } from "../../stores/hrDeskStore";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string; canManage: boolean };

export function HrPoliciesPage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const { policies, loading, error, lastFetchedAt, hydratePolicies, refreshPolicies, savePolicies } =
    useHrDeskStore(
      useShallow((s) => ({
        policies: s.policies,
        loading: s.policiesLoading,
        error: s.policiesError,
        lastFetchedAt: s.lastPoliciesAt,
        hydratePolicies: s.hydratePolicies,
        refreshPolicies: s.refreshPolicies,
        savePolicies: s.savePolicies
      }))
    );

  const [lateCheckInTime, setLateCheckInTime] = useState("09:00");
  const [defaultDays, setDefaultDays] = useState(21);
  const [entitlements, setEntitlements] = useState<HrPolicies["roleLeaveEntitlements"]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    hydratePolicies({ force: true });
  }, [hydratePolicies]);

  useEffect(() => {
    if (!policies) {
      return;
    }
    setLateCheckInTime(policies.lateCheckInTime.slice(0, 5));
    setDefaultDays(policies.defaultAnnualLeaveDays);
    setEntitlements(policies.roleLeaveEntitlements);
  }, [policies]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canManage) {
      return;
    }
    setSaving(true);
    try {
      await savePolicies({
        lateCheckInTime,
        defaultAnnualLeaveDays: defaultDays,
        roleLeaveEntitlements: entitlements
      });
      showToast("HR policies saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <HrSectionShell
      title="HR policies"
      subtitle="Set the late check-in time and annual leave days for each job title."
      displayName={displayName}
      loading={loading && !policies}
      error={error}
      updatedLabel={updatedLabel}
      onRefresh={() => void refreshPolicies()}
      refreshing={loading}
    >
      <form className="card stack-form" onSubmit={handleSubmit}>
        <h3>Attendance</h3>
        <label className="field">
          <span>Late check-in after</span>
          <input
            type="time"
            value={lateCheckInTime}
            onChange={(e) => setLateCheckInTime(e.target.value)}
            disabled={!canManage}
            required
          />
        </label>
        <p className="muted">
          Staff who clock in after this time on Universal Operations are marked <strong>late</strong>.
        </p>

        <h3>Leave entitlements</h3>
        <label className="field">
          <span>Default annual leave (days)</span>
          <input
            type="number"
            min={0}
            value={defaultDays}
            onChange={(e) => setDefaultDays(Number(e.target.value))}
            disabled={!canManage}
          />
        </label>
        <p className="muted">Used for job titles without a specific override below.</p>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Job title</th>
                <th>Annual leave days</th>
              </tr>
            </thead>
            <tbody>
              {entitlements.map((row, index) => (
                <tr key={row.roleKey}>
                  <td>{row.roleLabel}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      className="field-input field-input--compact"
                      value={row.annualLeaveDays}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...entitlements];
                        next[index] = { ...row, annualLeaveDays: Number(e.target.value) };
                        setEntitlements(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManage ? (
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Saving…" : "Save policies"}
          </button>
        ) : null}
      </form>
    </HrSectionShell>
  );
}
