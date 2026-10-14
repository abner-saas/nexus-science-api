import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFinancePeriod } from "./finance-period.js";

const today = "2026-10-13";

describe("resolveFinancePeriod", () => {
  it("covers the current month through today", () => {
    assert.deepEqual(resolveFinancePeriod("this_month", today), {
      from: "2026-10-01",
      to: "2026-10-13",
    });
  });

  it("covers the full previous month, including January", () => {
    assert.deepEqual(resolveFinancePeriod("prev_month", today), {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    assert.deepEqual(resolveFinancePeriod("prev_month", "2026-01-15"), {
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("covers the last 12 calendar months", () => {
    assert.deepEqual(resolveFinancePeriod("12m", today), {
      from: "2025-11-01",
      to: "2026-10-13",
    });
  });

  it("covers the year to date", () => {
    assert.deepEqual(resolveFinancePeriod("ytd", today), {
      from: "2026-01-01",
      to: "2026-10-13",
    });
  });

  it("accepts a custom range and rejects an inverted one", () => {
    assert.deepEqual(
      resolveFinancePeriod("custom", today, { from: "2026-03-01", to: "2026-03-31" }),
      {
        from: "2026-03-01",
        to: "2026-03-31",
      },
    );
    assert.deepEqual(
      resolveFinancePeriod("custom", today, { from: "2026-04-02", to: "2026-04-01" }),
      {
        error: "invalid_range",
      },
    );
    assert.deepEqual(resolveFinancePeriod("custom", today, {}), { error: "invalid_range" });
  });
});
