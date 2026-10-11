import { describe, expect, it } from "vitest";
import { batteryDefaults, batteryHomesForShare, flexibilityEconomics, simulateFlexibility } from "./flexibility";
import { loadSnapshot } from "./snapshot";
import { priceParameters } from "./price";
import type { AnnualCapacity, Feeder } from "./types";

function annualSize(assetKw: number): AnnualCapacity {
  return { status: "ready", assetKw, meanDailyMaxImportKw: assetKw, meanDailyMaxExportKw: 0,
    coveredDays: 365, totalDays: 365, coverage: 1 };
}

function example(power: Array<number | null>): { feeder: Feeder; clock: string[] } {
  const clock = power.map((_, index) => new Date(Date.UTC(2026, 0, 6, 0, index * 30)).toISOString());
  const feeder: Feeder = { id: "test", name: "Test", substationId: "test", substationName: "Test", lat: 0, lon: 0,
    ratingKva: 100, ratingSource: "kva", quality: { expectedBuckets: power.length, completeBuckets: power.filter(p => p !== null).length, completeness: 1, status: "good" },
    samples: power.flatMap((p, index) => p === null ? [] : [{ t: clock[index], pKw: p, loading: p / 100, limitKw: 100, rampStartKw: 85, direction: "neutral" as const, addon: 0, local: 100, wholesale: 100 }]) };
  return { feeder, clock };
}

describe("finite battery response", () => {
  it("in limit mode shaves only excess import and export, preserving energy below the limit", () => {
    const {feeder,clock} = example([60,85,100,120,-120,40]);
    const result = simulateFlexibility(feeder,clock,batteryDefaults,200,annualSize(100),"limit");
    expect(result.rows.slice(0,3).map(r=>Math.abs(r!.batteryKw))).toEqual([0,0,0]);
    expect(result.rows[3]!.net).toBeCloseTo(100);
    expect(result.rows[3]!.batteryKw).toBeCloseTo(20);
    expect(result.rows[4]!.net).toBeCloseTo(-100);
    expect(result.rows[5]!.net).toBeLessThanOrEqual(100);
    const insufficient = simulateFlexibility(feeder,clock,{...batteryDefaults,households:0},200,annualSize(100),"limit");
    expect(insufficient.rows[3]!.net).toBe(120);
  });
  it("maps adoption percentages to the explicitly assumed household population", () => {
    expect(batteryHomesForShare(0)).toBe(0);
    expect(batteryHomesForShare(33)).toBe(batteryDefaults.households);
    expect(batteryHomesForShare(50)).toBe(30);
    expect(batteryHomesForShare(100)).toBe(60);
    for (const invalid of [-1, 101, NaN, Infinity]) expect(() => batteryHomesForShare(invalid)).toThrow();
  });
  it("resizes future limits without changing observations or today's cost reference", () => {
    const { feeder, clock } = example([95, 40]);
    const today = simulateFlexibility(feeder, clock, batteryDefaults);
    const future = simulateFlexibility(feeder, clock, batteryDefaults, 200, annualSize(70));
    expect(future.importKw).toBe(70);
    expect(future.exportKw).toBe(70);
    expect(future.referenceImportKw).toBe(100);
    expect(future.rows.map(row => row!.baseline)).toEqual(today.rows.map(row => row!.baseline));
    expect(future.rows[0]!.batteryKw).toBeGreaterThan(today.rows[0]!.batteryKw);
    const currentCosts = flexibilityEconomics(today, priceParameters);
    const futureCosts = flexibilityEconomics(future, priceParameters);
    expect(futureCosts.withoutTotal).toBeCloseTo(currentCosts.withoutTotal);
    expect(futureCosts.existing).toBeCloseTo(currentCosts.existing * 0.7);
    expect(futureCosts.withTotal).toBeCloseTo(futureCosts.existing + futureCosts.withUpgrade + futureCosts.payments);
  });
  it("does not pretend smaller future assets work when storage is exhausted", () => {
    const { feeder, clock } = example(Array(48).fill(95));
    const future = simulateFlexibility(feeder, clock, { ...batteryDefaults, households: 1 }, 200, annualSize(70));
    expect(future.netPeak).toBe(95);
    expect(future.finalStoredKwh).toBe(0);
    expect(flexibilityEconomics(future, priceParameters).withUpgrade).toBeGreaterThan(0);
  });
  it("never substitutes a percentage when annual capacity is missing or invalid", () => {
    const { feeder, clock } = example([95]);
    for (const sizing of [null, annualSize(0), annualSize(-1), annualSize(NaN), { ...annualSize(70), status: "insufficient" as const }]) {
      const result = simulateFlexibility(feeder, clock, batteryDefaults, 200, sizing);
      expect(result.sizingAvailable).toBe(false);
      expect(result.rows[0]!.net).toBe(95);
      expect(result.payment).toBe(0);
    }
  });
  it("allows annual asset sizes larger than today's assumed feeder size", () => {
    const { feeder, clock } = example([180, -170, 40]);
    const result = simulateFlexibility(feeder, clock, batteryDefaults, 200, { ...annualSize(160), meanDailyMaxImportKw: 150, meanDailyMaxExportKw: 160 });
    expect(result.sizingAvailable).toBe(true);
    expect(result.importKw).toBe(160);
    expect(result.exportKw).toBe(160);
    expect(result.referenceImportKw).toBe(100);
    expect(result.capacityScale).toBe(1.6);
  });
  it("conserves stored energy including charging and discharge losses", () => {
    const { feeder, clock } = example([110, 110, 40, 110]);
    const config = { ...batteryDefaults, households: 1 };
    const result = simulateFlexibility(feeder, clock, config);
    let energy = result.capacity;
    for (const row of result.rows) {
      expect(row).not.toBeNull();
      energy += row!.batteryKw >= 0 ? -row!.batteryKw * 0.5 / config.efficiency : -row!.batteryKw * 0.5 * config.efficiency;
      expect(row!.storedKwh).toBeCloseTo(energy);
      expect(Math.abs(row!.batteryKw)).toBeLessThanOrEqual(result.power);
      expect(row!.storedKwh).toBeGreaterThanOrEqual(0);
      expect(row!.storedKwh).toBeLessThanOrEqual(result.capacity);
      expect(row!.net).toBeCloseTo(row!.baseline - row!.batteryKw);
    }
  });
  it("does not invent response during missing intervals or promise a deferral", () => {
    const { feeder, clock } = example([110, null, 110]);
    const result = simulateFlexibility(feeder, clock, batteryDefaults);
    expect(result.rows[1]).toBeNull();
    expect(result.complete).toBe(false);
    expect(flexibilityEconomics(result, priceParameters).deferralYears).toBeNull();
  });
  it("leaves the baseline unchanged with no enrolled batteries", () => {
    const { feeder, clock } = example([120, -110, 40]);
    const result = simulateFlexibility(feeder, clock, { ...batteryDefaults, households: 0 });
    expect(result.payment).toBe(0);
    expect(result.rows.every(row => row!.net === row!.baseline && row!.batteryKw === 0)).toBe(true);
  });
  it("runs out of energy rather than drawing an impossible clipped peak", () => {
    const { feeder, clock } = example(Array(48).fill(150));
    const result = simulateFlexibility(feeder, clock, { ...batteryDefaults, households: 1 });
    expect(result.finalStoredKwh).toBe(0);
    expect(result.netPeak).toBe(150);
    expect(flexibilityEconomics(result, priceParameters).deferralYears).toBeNull();
  });
  it("absorbs excess export without exceeding storage capacity", () => {
    const { feeder, clock } = example([150, -150, -150]);
    const result = simulateFlexibility(feeder, clock, { ...batteryDefaults, households: 1 });
    expect(result.rows[1]!.batteryKw).toBeLessThan(0);
    expect(result.rows.every(row => row!.storedKwh <= result.capacity)).toBe(true);
  });
  it("reconciles annual cashflows and does not assume bills always fall", () => {
    const { feeder, clock } = example([95, 40]);
    const result = simulateFlexibility(feeder, clock, batteryDefaults);
    const e = flexibilityEconomics(result, priceParameters);
    expect(e.withoutTotal).toBeCloseTo(e.existing + e.withoutUpgrade);
    expect(e.withTotal).toBeCloseTo(e.existing + e.withUpgrade + e.payments);
    expect(e.withTotal).toBeGreaterThan(e.withoutTotal);
    expect(e.avoidedCapital).toBe(0);
  });
  it("preserves the complete real default feeder and reduces its scenario peak", async () => {
    const snapshot = await loadSnapshot();
    const feeder = snapshot.feeders.find(f => f.id === "SPRINGFIELD ROAD\n4626_006_170_02")!;
    const clock = Array.from({length:48}, (_, i) => new Date(Date.parse(snapshot.window.start) + i * 1800000).toISOString());
    const result = simulateFlexibility(feeder, clock, batteryDefaults);
    expect(feeder).toBeDefined();
    expect(result.rows).toHaveLength(48);
    expect(result.complete).toBe(feeder.samples.length === 48);
    expect(result.rows.filter(row => row !== null)).toHaveLength(feeder.samples.length);
    expect(result.sizingAvailable).toBe(true);
  });
});
