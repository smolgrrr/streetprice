import { describe, expect, it } from "vitest";
import { capacityFeasible, sizingCurve } from "./sizing-equilibrium";
import { priceParameters } from "./price";

describe("energy-only feeder sizing", () => {
  it("requires both battery power and energy to cover a sustained peak", () => {
    expect(capacityFeasible([60, 110, 60, 60], 100, 1)).toBe(true);
    expect(capacityFeasible([60, ...Array(6).fill(110), 60], 100, 1)).toBe(false);
    expect(capacityFeasible([60, 110, 60], 100, 0)).toBe(false);
  });
  it("allows charge to be saved for a later import peak and headroom for export", () => {
    expect(capacityFeasible([40, 110, 40, -110], 100, 1)).toBe(true);
    expect(capacityFeasible([-110], 100, 1)).toBe(false);
  });
  it("sets zero adoption to the observed peak and prices only constrained energy", () => {
    const curve = sizingCurve([60, 120, 60, 120, 60, 60], 6, priceParameters, 2);
    expect(curve.points[0].capacityKw).toBe(120);
    expect(curve.points[0].tariffGbpPerKwh).toBeNull();
    expect(curve.points[1].capacityKw).toBeLessThan(120);
    expect(curve.points[1].tariffGbpPerKwh).toBeGreaterThan(0);
    expect(curve.points[1].annualPaymentGbp).toBeCloseTo(curve.points[1].dispatchedKwh * curve.points[1].tariffGbpPerKwh!);
  });
});
