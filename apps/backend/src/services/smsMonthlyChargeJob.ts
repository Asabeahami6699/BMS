import { formatAccountAmount } from "@bms/shared";
import { listTenantsWithSmsChargesEnabled } from "./tenantSmsSettingsService.js";
import {
  chargeTenantCustomersSmsMonthly,
  smsChargePeriodKey
} from "./smsMonthlyChargeService.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly — picks up any tenant/customer still due this month
let started = false;

export async function processSmsMonthlyCharges(): Promise<{
  tenants: number;
  charged: number;
  skipped: number;
  failed: number;
}> {
  const settingsList = await listTenantsWithSmsChargesEnabled();
  const periodKey = smsChargePeriodKey();
  let charged = 0;
  let skipped = 0;
  let failed = 0;

  for (const settings of settingsList) {
    const amount = Number(settings.smsChargeAmountGhs ?? 0);
    if (!settings.smsChargesEnabled || !(amount > 0)) {
      continue;
    }
    try {
      const result = await chargeTenantCustomersSmsMonthly({
        tenantId: settings.tenantId,
        amount,
        periodKey
      });
      charged += result.charged;
      skipped += result.skipped;
      failed += result.failed;
      if (result.charged > 0) {
        console.log(
          `[sms] monthly charge ${periodKey} tenant=${settings.tenantId} amount=GHS ${formatAccountAmount(amount)} charged=${result.charged} skipped=${result.skipped} failed=${result.failed}`
        );
      }
    } catch (error) {
      failed += 1;
      console.warn(
        `[sms] monthly charge job failed for tenant ${settings.tenantId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { tenants: settingsList.length, charged, skipped, failed };
}

export function startSmsMonthlyChargeJob(): void {
  if (started) {
    return;
  }
  started = true;

  const run = () => {
    void processSmsMonthlyCharges()
      .then(({ tenants, charged, skipped, failed }) => {
        if (tenants > 0 && (charged > 0 || failed > 0)) {
          console.log(
            `[sms] monthly charges: tenants ${tenants}, charged ${charged}, skipped ${skipped}, failed ${failed}`
          );
        }
      })
      .catch((error) => {
        console.warn(
          "[sms] monthly charge job failed:",
          error instanceof Error ? error.message : error
        );
      });
  };

  // Delay past other hourly jobs so the API is warm.
  setTimeout(run, 150_000);
  setInterval(run, INTERVAL_MS);
}
