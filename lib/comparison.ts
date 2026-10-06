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

export type InstantHero = {
  /** Signed local minus wholesale for the feeder furthest from wholesale. */
  localSwingGbpPerMwh: number | null;
  wholesaleGbpPerMwh: number | null;
  /** Local ÷ wholesale for the feeder furthest from 1. */
  ratio: number | null;
};

/** Figures for one half-hour, taken across every feeder that has a reading. */
export function heroAtTime(samples: Array<{ local: number; wholesale: number }>): InstantHero {
  const usable = samples.filter((sample) => Number.isFinite(sample.local) && Number.isFinite(sample.wholesale));
  if (usable.length === 0) {
    return { localSwingGbpPerMwh: null, wholesaleGbpPerMwh: null, ratio: null };
  }
  const furthest = usable.reduce((best, sample) =>
    Math.abs(sample.local - sample.wholesale) > Math.abs(best.local - best.wholesale) ? sample : best,
  );
  const ratios = usable.filter((sample) => sample.wholesale !== 0);
  const furthestRatio = ratios.reduce<(typeof ratios)[number] | null>((best, sample) => {
    if (!best) return sample;
    return Math.abs(sample.local / sample.wholesale - 1) > Math.abs(best.local / best.wholesale - 1) ? sample : best;
  }, null);
  return {
    localSwingGbpPerMwh: furthest.local - furthest.wholesale,
    wholesaleGbpPerMwh: usable[0].wholesale,
    ratio: furthestRatio ? furthestRatio.local / furthestRatio.wholesale : null,
  };
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
