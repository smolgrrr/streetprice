import { describe, expect, it } from "vitest";
import {
  ASSUMED_FUSE_AMPS,
  feedersFromLines,
  selectCohort,
  type DiscoveredLine,
} from "./cohort";
import type { CohortFeeder } from "./types";
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

describe("local area cohort", () => {
  function feeder(overrides: Partial<CohortFeeder>): CohortFeeder {
    return {
      id: "SITE\n1",
      name: "Feeder 1",
      substationId: "SITE",
      substationName: "Site",
      lat: 51.76,
      lon: -1.27,
      ratingKva: 139,
      ratingSource: "assumed-feeder-fuse",
      powerScaleToKw: 1,
      powerMeasurementIds: ["p"],
      currentMeasurementIds: [],
      currentLimitAmps: 200,
      ...overrides,
    };
  }

  it("keeps every feeder inside the Oxford box, in name order", () => {
    const cohort = selectCohort([
      feeder({ id: "ZEBRA\n2", name: "Feeder 2", substationId: "ZEBRA", substationName: "Zebra Road" }),
      feeder({ id: "OUT\n1", lat: 51.5, lon: -1.25, substationName: "Outside" }),
      feeder({ id: "ALPHA\n10", name: "Feeder 10", substationId: "ALPHA", substationName: "Alpha Road", lat: 51.8, lon: -1.2 }),
      feeder({ id: "ALPHA\n2", name: "Feeder 2", substationId: "ALPHA", substationName: "Alpha Road", lat: 51.8, lon: -1.2 }),
    ]);
    expect(cohort.map((item) => item.id)).toEqual(["ALPHA\n2", "ALPHA\n10", "ZEBRA\n2"]);
  });
});
