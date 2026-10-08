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
  constraintModel?: {
    version: number;
    observationRole: "historical-load-as-hypothetical-forecast";
    rampStart: number;
    defaultImportLimit: { amps: number; volts: number; phases: number; powerFactor: number; provenance: "scenario-assumption" };
    defaultImportCost: { gbpPerKva: number; lifeYears: number; discountRate: number; bindingHoursPerYear: number; provenance: "scenario-assumption" };
    exportLimit: { value: null; provenance: "unavailable" };
    search: { requestedMonths: number; status: string; selectedDay: null | string; coverage: null | number };
    sources: Array<{ label: string; url: string; use: string }>;
  };
  /** Street traces for this snapshot. Absent on the synthetic fixture, which traces locally. */
  streets?: {
    traces: Array<{
      feederId: string;
      substationId: string;
      coordinates: [number, number][][];
    }>;
    stubs: Array<{
      substationId: string;
      coordinates: [[number, number], [number, number]];
    }>;
  };
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
