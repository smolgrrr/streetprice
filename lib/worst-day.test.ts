import { describe, expect, it } from "vitest";
import { alignWorstDay, openingFeeder, worstObservedDay, simulateWorstDay } from "./worst-day";
import { batteryDefaults } from "./flexibility";
import { buildFixture } from "./fixture";
import type { AnnualCapacity, AnnualCapacityModel, WorstDay } from "./types";

const start = new Date("2025-01-01T00:00:00Z"), end = new Date("2025-01-04T00:00:00Z");
const points = (date: string, value: number, count = 48) => Array.from({ length: count }, (_, i) => ({
  t: new Date(Date.parse(`${date}T00:00:00Z`) + i * 1800000).toISOString(), value,
}));

describe("annual worst-day comparison", () => {
  it("dispatches the worst day against proposed capacity without hiding exhausted batteries or gaps", () => {
    const feeder = buildFixture().feeders[0];
    const day: WorstDay = { date:"2025-01-01", peakLoading:1.2, expectedBuckets:48, samples:points("2025-01-01",120) };
    const annual = {status:"ready",assetKw:100} as AnnualCapacity;
    const enough = simulateWorstDay(feeder, day, {...batteryDefaults,households:60}, annual);
    expect(enough.netPeak).toBeLessThanOrEqual(100);
    const none = simulateWorstDay(feeder, day, {...batteryDefaults,households:0}, annual);
    expect(none.netPeak).toBe(120);
    const exhausted = simulateWorstDay(feeder, day, {...batteryDefaults,households:1}, annual);
    expect(exhausted.netPeak).toBeGreaterThan(100);
    day.samples.splice(5,1);
    expect(simulateWorstDay(feeder,day,batteryDefaults,annual).rows[5]).toBeNull();
  });
  it("prefers a complete 24-hour feeder even if a sparse feeder is closer to its limit", () => {
    const feeders = buildFixture().feeders.slice(0, 2);
    const clock = feeders[0].samples.map(s => s.t);
    feeders[1] = { ...feeders[1], samples: feeders[1].samples.slice(1) };
    const annual = { feeders: Object.fromEntries(feeders.map((f, i) => [f.id, {status:"ready",worstDay:{peakLoading:[.8,1][i]}}])) } as AnnualCapacityModel;
    expect(openingFeeder(feeders, annual, 200, clock).id).toBe(feeders[0].id);
    feeders[1].samples = [...feeders[0].samples.slice(1), feeders[0].samples[1]];
    expect(openingFeeder(feeders, annual, 200, clock).id).toBe(feeders[0].id);
  });
  it("ranks directional loading rather than energy or signed import alone", () => {
    const day = worstObservedDay([...points("2025-01-01", 110), ...points("2025-01-02", -90)], start, end, 200, 100);
    expect(day?.date).toBe("2025-01-02");
    expect(day?.peakLoading).toBe(.9);
    expect(day?.samples).toHaveLength(48);
  });
  it("excludes sparse days, duplicate timestamps, out-of-window and nonfinite readings", () => {
    const available = points("2025-01-01", 70);
    const day = worstObservedDay([...available, ...available, ...points("2025-01-02", 999, 23),
      ...points("2024-12-31", 9000), {t:"2025-01-03T00:00:00Z",value:NaN}], start, end, 100, 100);
    expect(day?.date).toBe("2025-01-01");
    expect(day?.samples).toHaveLength(48);
    expect(worstObservedDay([], start, end, 100, 100)).toBeNull();
  });
  it("aligns winter and summer by London clock time without filling missing readings", () => {
    const day: WorstDay = {date:"2025-01-01",peakLoading:1,expectedBuckets:48,
      samples:[{t:"2025-01-01T10:00:00Z",value:100}]};
    expect(alignWorstDay(day, ["2026-06-01T09:00:00Z", "2026-06-01T09:30:00Z"])).toEqual([100,null]);
    expect(alignWorstDay(null, ["2026-06-01T09:00:00Z"])).toEqual([null]);
  });
  it("does not invent a unique comparison during the repeated DST hour", () => {
    const day: WorstDay = {date:"2025-10-26",peakLoading:1,expectedBuckets:50,
      samples:[{t:"2025-10-26T00:00:00Z",value:100},{t:"2025-10-26T01:00:00Z",value:50}]};
    expect(alignWorstDay(day, ["2026-01-01T01:00:00Z"])).toEqual([null]);
  });
  it("opens the feeder whose annual peak is closest to 100%, not the highest current load", () => {
    const feeders = buildFixture().feeders.slice(0, 3);
    const annual = { feeders: Object.fromEntries(feeders.map((f, i) => [f.id, {status:"ready",worstDay:{peakLoading:[.5,1.01,1.5][i]}}])) } as AnnualCapacityModel;
    expect(openingFeeder(feeders, annual).id).toBe(feeders[1].id);
    expect(openingFeeder(feeders).id).toBeTruthy();
  });
});
