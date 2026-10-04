import type { PriceParameters, PricedSample } from "./price";

export type RatingSource = "amps" | "kva" | "assumed-transformer-share" | "assumed-feeder-fuse";

export type QualityStatus = "good" | "partial" | "insufficient";

export type DataQuality = {
  expectedBuckets: number;
  completeBuckets: number;
  completeness: number;
  status: QualityStatus;
};

export type Feeder = {
  id: string;
  name: string;
  substationId: string;
  substationName: string;
  lat: number;
  lon: number;
  ratingKva: number;
  ratingSource: RatingSource;
  quality: DataQuality;
  samples: PricedSample[];
};

export type SnapshotComparison = {
  localSwingGbpPerMwh: number;
  wholesaleSwingGbpPerMwh: number;
  ratio: number | null;
  feederCount: number;
};

export type Snapshot = {
  updatedAt: string;
  source: "fixture" | "nerda-historical";
  mode: "synthetic" | "historical";
  window: {
    start: string;
    end: string;
    dataThrough: string;
  };
  capGbpPerMwh: number;
  ratingAssumptionAmps: number;
  parameters: PriceParameters;
  comparison: SnapshotComparison;
  feeders: Feeder[];
};

export type CohortFeeder = {
  id: string;
  name: string;
  substationId: string;
  substationName: string;
  lat: number;
  lon: number;
  ratingKva: number;
  ratingSource: RatingSource;
  /** Multiply a raw NeRDA power reading by this to get kW. */
  powerScaleToKw: number;
  powerMeasurementIds: string[];
  currentMeasurementIds: string[];
  currentLimitAmps: number | null;
};
