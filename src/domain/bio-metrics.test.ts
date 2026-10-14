import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bioUpdateSet, buildLocalInsight, coerceDecimal } from "./bio-metrics.js";

describe("coerceDecimal", () => {
  it("accepts comma, dot and numeric liters", () => {
    assert.deepEqual(coerceDecimal("2,5", 1), { ok: true, value: "2.5" });
    assert.deepEqual(coerceDecimal(2.5, 1), { ok: true, value: "2.5" });
    assert.deepEqual(coerceDecimal("2.50", 1), { ok: true, value: "2.5" });
    assert.deepEqual(coerceDecimal("70.00", 2), { ok: true, value: "70.00" });
  });

  it("keeps an omitted field distinct from an empty one", () => {
    assert.deepEqual(coerceDecimal(undefined, 1), { ok: true, value: undefined });
    assert.deepEqual(coerceDecimal("", 1), { ok: true, value: null });
    assert.deepEqual(coerceDecimal(null, 1), { ok: true, value: null });
  });

  it("rejects text that is not a number", () => {
    assert.deepEqual(coerceDecimal("muita", 1), { ok: false });
    assert.deepEqual(coerceDecimal(-1, 1), { ok: false });
  });
});

describe("bioUpdateSet", () => {
  it("does not null mood or hydration when the payload omits them", () => {
    const set = bioUpdateSet({ energy: 8, sleep: 7 });
    assert.deepEqual(set, { energy: 8, sleep: 7 });
    assert.equal("mood" in set, false);
    assert.equal("hydration" in set, false);
  });

  it("writes mood and hydration when they are present", () => {
    const set = bioUpdateSet({ mood: 6, hydration: "2.5" });
    assert.equal(set.mood, 6);
    assert.equal(set.hydration, "2.5");
  });
});

describe("buildLocalInsight", () => {
  it("includes humor and hydration in the reading", () => {
    const text = buildLocalInsight("Ana", "Hipertrofia", [
      {
        energy: 7,
        mood: 3,
        stress: 4,
        sleep: 8,
        musclePain: 2,
        hydration: "1.5",
      },
    ]);
    assert.match(text, /humor 3/);
    assert.match(text, /hidratação 1\.5 L/);
    assert.match(text, /Humor baixo/);
    assert.match(text, /Hidratação abaixo de 2 L/);
  });
});
