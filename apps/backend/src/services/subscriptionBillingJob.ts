import { runSubscriptionBillingSweep } from "./subscriptionBillingService.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly

let started = false;

export function startSubscriptionBillingJob(): void {
  if (started) {
    return;
  }
  started = true;

  const run = () => {
    void runSubscriptionBillingSweep()
      .then((result) => {
        if (result.dueSoon || result.grace || result.sms || result.suspended) {
          console.log(
            `[billing] sweep: dueSoon=${result.dueSoon} grace=${result.grace} sms=${result.sms} suspended=${result.suspended}`
          );
        }
      })
      .catch((error) => {
        console.warn(
          "[billing] sweep failed:",
          error instanceof Error ? error.message : error
        );
      });
  };

  setTimeout(run, 60_000);
  setInterval(run, INTERVAL_MS);
}
