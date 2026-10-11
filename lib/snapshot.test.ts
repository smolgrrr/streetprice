import { describe, expect, it } from "vitest";
import { loadSnapshot } from "./snapshot";
import { annualWindow } from "./annual-capacity";

describe("committed Oxford snapshot", () => {
  it("packages a 24-hour window and complete Vercel map cohort", async () => {
    const snapshot = await loadSnapshot();
    expect(Date.parse(snapshot.window.end) - Date.parse(snapshot.window.start)).toBe(86_400_000);
    expect(Date.parse(snapshot.window.dataThrough)).toBeLessThan(Date.parse(snapshot.window.end));
    expect(Date.parse(snapshot.window.dataThrough)).toBeGreaterThanOrEqual(Date.parse(snapshot.window.start));
    expect(snapshot.feeders).toHaveLength(187);
    expect(new Set(snapshot.feeders.map((feeder) => feeder.substationId)).size).toBe(85);
    expect(snapshot.streets?.traces).toHaveLength(187);
  });

  it("contains constraint-model fields rather than daily-mean targets", async () => {
    const snapshot = await loadSnapshot();
    const sample = snapshot.feeders.flatMap((feeder) => feeder.samples)[0];
    expect(sample.limitKw).toBeGreaterThan(0);
    expect(sample.rampStartKw).toBeCloseTo(sample.limitKw * 0.85);
    expect(sample.direction).toMatch(/^(import|export|neutral|unknown)$/);
    expect(sample).not.toHaveProperty("targetKw");
  });

  it("keeps published shared ratings separate from assumed feeder limits", async () => {
    const snapshot = await loadSnapshot();
    expect(snapshot.transformerRatings).toHaveLength(85);
    expect(snapshot.transformerRatings?.filter((item) => item.status === "published")).toHaveLength(79);
    expect(snapshot.transformerRatings?.find((item) => item.nrn === "4626002080")?.ratingKva).toBe(1500);
    expect(snapshot.transformerRatings?.find((item) => item.nrn === "4602014030")?.ratingKva).toBe(315);
    expect(snapshot.transformerRatings?.find((item) => item.nrn === "4603016080")?.ratingKva).toBeNull();
    expect(snapshot.feeders.every((item) => item.ratingSource === "assumed-feeder-fuse")).toBe(true);
  });

  it("ships annual coverage for every feeder without percentage fallbacks", async () => {
    const snapshot = await loadSnapshot();
    const annual = snapshot.annualCapacity!;
    expect(annual).toBeDefined();
    expect(Object.keys(annual.feeders)).toHaveLength(187);
    expect(Object.keys(annual.substations)).toHaveLength(85);
    const expected = annualWindow(new Date(snapshot.window.end));
    expect(annual.window).toEqual({ start: expected.start.toISOString(), end: expected.end.toISOString() });
    for (const feeder of snapshot.feeders) {
      const stats = annual.feeders[feeder.id];
      expect(stats).toBeDefined();
      if (stats.status === "ready") {
        expect(stats.assetKw).toBeGreaterThanOrEqual(Math.max(stats.meanDailyMaxImportKw!, stats.meanDailyMaxExportKw!) - 1e-8);
        expect(stats.coverage).toBeGreaterThanOrEqual(.9);
      } else {
        expect(stats.assetKw).toBeNull();
      }
    }
    expect(snapshot.windowMode).toMatch(/^(previous-24h|latest-available-24h)$/);
    expect(snapshot.constraintModel?.search.selectedDay).toBeNull();
  });
});
