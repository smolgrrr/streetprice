import { describe, expect, it } from "vitest";
import {
  constraintSignal,
  dayBounds,
  defaultScenario,
  ramp,
  rankDays,
  signalCap,
} from "./constraint";

describe("constraint signal", () => {
  it("ramps from the configured threshold and caps at the limit", () => {
    expect(ramp(0.84, 0.85)).toBe(0);
    expect(ramp(0.925, 0.85)).toBeCloseTo(0.5);
    expect(ramp(1.2, 0.85)).toBe(1);
  });

  it("converts annualised reinforcement cost to pounds per kWh", () => {
    expect(signalCap(80, defaultScenario)).toBeCloseTo(0.30006, 4);
  });

  it("keeps import and export signals asymmetric", () => {
    const imported = constraintSignal(130, 138.56, defaultScenario);
    expect(imported.direction).toBe("import");
    expect(imported.price).toBeGreaterThan(0);

    const unknownExport = constraintSignal(-80, 138.56, defaultScenario);
    expect(unknownExport.direction).toBe("unknown");
    expect(unknownExport.price).toBeNull();

    const withExport = { ...defaultScenario, exportKw: 80, exportCost: 40 };
    const exported = constraintSignal(-80, 138.56, withExport);
    expect(exported.direction).toBe("export");
    expect(exported.price).toBeLessThan(0);
  });
});

describe("London calendar ranking", () => {
  it("uses 46 and 50 half-hours on DST transition days", () => {
    expect(dayBounds("2026-03-29").buckets).toBe(46);
    expect(dayBounds("2026-10-25").buckets).toBe(50);
  });

  it("excludes incomplete days and applies deterministic tie breaks", () => {
    const days = ["2026-01-01", "2026-01-02"];
    const samples = days.flatMap((day) =>
      Array.from({ length: 48 }, (_, index) => ({
        t: new Date(`${day}T00:00:00Z`).getTime() + index * 1_800_000,
        pKw: index === 40 ? 150 : 100,
      })).map((point) => ({ t: new Date(point.t).toISOString(), pKw: point.pKw })),
    );
    const result = rankDays([
      { id: "f1", ratingKva: 138.56, ratingSource: "assumed-feeder-fuse", samples },
    ], days, defaultScenario);
    expect(result.cohort).toEqual(["f1"]);
    expect(result.ranked.map((day) => day.day)).toEqual(days);
    expect(result.winner?.day).toBe("2026-01-01");
  });
});
