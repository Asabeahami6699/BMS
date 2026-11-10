import { applyCustomerInactivityRules } from "./customerService.js";
import { sendCustomerLifecycleWarningSms } from "./customerLifecycleAlertService.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly

let started = false;

export function startCustomerInactivityJob(): void {
  if (started) {
    return;
  }
  started = true;

  const run = () => {
    void applyCustomerInactivityRules()
      .then(({ markedInactive, markedDormant }) => {
        if (markedInactive > 0 || markedDormant > 0) {
          console.log(
            `[customers] inactivity rules: ${markedInactive} inactive, ${markedDormant} dormant`
          );
        }
      })
      .catch((error) => {
        console.warn(
          "[customers] inactivity job failed:",
          error instanceof Error ? error.message : error
        );
      });

    void sendCustomerLifecycleWarningSms()
      .then(({ inactiveWarnings, dormantWarnings }) => {
        if (inactiveWarnings > 0 || dormantWarnings > 0) {
          console.log(
            `[customers] lifecycle SMS: ${inactiveWarnings} inactive warnings, ${dormantWarnings} dormant warnings`
          );
        }
      })
      .catch((error) => {
        console.warn(
          "[customers] lifecycle SMS job failed:",
          error instanceof Error ? error.message : error
        );
      });
  };

  // Delay first run so boot/migrations settle
  setTimeout(run, 45_000);
  setInterval(run, INTERVAL_MS);
}
