import { describe, expect, it } from "vitest";
import {
  ASSUMED_FUSE_AMPS,
  feedersFromLines,
  PILOT_FEEDERS,
  selectCohort,
  type DiscoveredLine,
} from "./cohort";
import { ratingKvaFromAmps } from "./price";

function line(overrides: Partial<DiscoveredLine> = {}): DiscoveredLine {
  return {
    substationId: "barton",
    substationName: "BARTON ROAD",
    lat: 51.76,
    lon: -1.22,
    lineName: "4603_008_020_01",
    feederName: "feeder1",
    limit: 0,
    hasCurrentLimit: true,
    power: [
      { id: "p-a", scaleToKw: 1, phase: "A", name: "P A RMS" },
      { id: "p-b", scaleToKw: 1, phase: "B", name: "P B RMS" },
    ],
    current: [{ id: "i-a", phase: "A", name: "I A RMS" }],
    ...overrides,
  };
}

describe("feeder grouping", () => {
  it("merges duplicate monitors of one circuit and assumes a 200 A fuse", () => {
    const feeders = feedersFromLines([
      line(),
      line({
        power: [
          { id: "p-a", scaleToKw: 1, phase: "A", name: "P A min" },
          { id: "p-c", scaleToKw: 1, phase: "C", name: "P C RMS" },
        ],
        current: [{ id: "i-a-copy", phase: "A", name: "I A max" }],
      }),
    ]);
    expect(feeders).toHaveLength(1);
    expect(feeders[0].name).toBe("Feeder 1");
    expect(feeders[0].substationName).toBe("Barton Road");
    expect(feeders[0].powerMeasurementIds.sort()).toEqual(["p-a", "p-b", "p-c"]);
    expect(feeders[0].currentMeasurementIds).toEqual(["i-a"]);
    expect(feeders[0].ratingSource).toBe("assumed-feeder-fuse");
    expect(feeders[0].ratingKva).toBeCloseTo(ratingKvaFromAmps(ASSUMED_FUSE_AMPS));
    expect(feeders[0].currentLimitAmps).toBe(200);
  });
});

describe("pilot cohort", () => {
  it("selects only the twelve fixed quality-checked feeders", () => {
    const feeders = [...PILOT_FEEDERS, "OTHER SITE\nother"].map((id, index) => ({
      id,
      name: `Feeder ${index + 1}`,
      substationId: id.split("\n")[0],
      substationName: id.split("\n")[0],
      lat: 51.76,
      lon: -1.27,
      ratingKva: 139,
      ratingSource: "assumed-feeder-fuse" as const,
      powerScaleToKw: 1,
      powerMeasurementIds: ["p"],
      currentMeasurementIds: [],
      currentLimitAmps: 200,
    }));
    const cohort = selectCohort(feeders);
    expect(cohort).toHaveLength(12);
    expect(new Set(cohort.map((feeder) => feeder.id))).toEqual(PILOT_FEEDERS);
  });
});
