import { describe, expect, it } from "vitest";
import { beginIdempotency } from "./idempotency.js";

describe("beginIdempotency", () => {
  it("posts one key once when two requests arrive together", async () => {
    const key = `once-${Date.now()}-${Math.random()}`;
    let calls = 0;

    async function attempt() {
      const claim = await beginIdempotency("tenant-idempotency-test", key);
      if (!claim.owned) {
        return claim.body;
      }
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      const value = { id: "tx-once" };
      await claim.finish(201, value);
      return value;
    }

    const [first, second] = await Promise.all([attempt(), attempt()]);
    expect(calls).toBe(1);
    expect(first).toEqual({ id: "tx-once" });
    expect(second).toEqual({ id: "tx-once" });
  });
});
