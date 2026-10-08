import { describe, expect, it } from "vitest";
import { loadSnapshot } from "./snapshot";

describe("committed Oxford snapshot", () => {
  it("packages the selected day and complete Vercel map cohort", async () => {
    const snapshot = await loadSnapshot();
    expect(snapshot.window.start).toBe("2026-01-06T00:00:00.000Z");
    expect(snapshot.constraintModel?.search.selectedDay).toBe("2026-01-06");
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
});
