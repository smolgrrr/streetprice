import type { DataQuality, Feeder, SnapshotComparison } from "./types";

export function qualityFor(completeBuckets: number, expectedBuckets: number): DataQuality {
  const completeness = expectedBuckets > 0 ? completeBuckets / expectedBuckets : 0;
  return {
    expectedBuckets,
    completeBuckets,
    completeness,
    status: completeness >= 0.8 ? "good" : completeness >= 0.5 ? "partial" : "insufficient",
  };
}

export function swing(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  return Math.max(...finite) - Math.min(...finite);
}

export function median(values: number[]): number {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (ordered.length === 0) return 0;
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

export function compareFeeders(feeders: Feeder[]): SnapshotComparison {
  const included = feeders.filter(
    (feeder) => feeder.quality.status !== "insufficient" && feeder.samples.length > 1,
  );
  const localSwingGbpPerMwh = median(
    included.map((feeder) => swing(feeder.samples.map((sample) => sample.addon))),
  );
  const wholesaleByTime = new Map<string, number>();
  for (const feeder of included) {
    for (const sample of feeder.samples) wholesaleByTime.set(sample.t, sample.wholesale);
  }
  const wholesaleSwingGbpPerMwh = swing([...wholesaleByTime.values()]);
  return {
    localSwingGbpPerMwh,
    wholesaleSwingGbpPerMwh,
    ratio: wholesaleSwingGbpPerMwh > 0 ? localSwingGbpPerMwh / wholesaleSwingGbpPerMwh : null,
    feederCount: included.length,
  };
}
