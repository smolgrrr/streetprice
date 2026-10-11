import type { PriceParameters, PricedSample } from "./price";
import type { FeederSizingCurve } from "./sizing-equilibrium";

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

export type AnnualCapacity = {
  timeProfile?: Array<{ time: string; p50: number; p90: number; p99: number; count: number }>;
  duration?: CapacityDuration;
  worstDay?: WorstDay | null;
  status: "ready" | "insufficient";
  meanDailyMaxImportKw: number | null;
  meanDailyMaxExportKw: number | null;
  assetKw: number | null;
  coveredDays: number;
  totalDays: number;
  coverage: number;
};

export type CapacityDuration = {
  points: Array<{ fraction: number; kw: number }>;
  observedHours: number;
  expectedHours: number;
  peakKw: number | null;
  nearPeakHours: number;
  targetKw: number | null;
  aboveTargetHours: number | null;
};

export type WorstDay = {
  date: string;
  peakLoading: number;
  expectedBuckets: number;
  samples: Array<{ t: string; value: number }>;
};

export type AnnualCapacityModel = {
  generatedAt: string;
  window: { start: string; end: string };
  method: "mean-daily-absolute-maxima";
  coverageRule: { day: number; year: number; month: number };
  feeders: Record<string, AnnualCapacity>;
  substations: Record<string, AnnualCapacity>;
};

export type SnapshotComparison = {
  localSwingGbpPerMwh: number;
  wholesaleSwingGbpPerMwh: number;
  ratio: number | null;
  feederCount: number;
};

export type Snapshot = {
  annualCapacity?: AnnualCapacityModel;
  sizing?: { generatedAt: string; window: { start: string; end: string }; feeders: Record<string, FeederSizingCurve> };
  windowMode?: "previous-24h" | "latest-available-24h" | "selected-day";
  transformerRatings?: Array<{
    nrn: string;
    name: string;
    ratingKva: number | null;
    status: "published" | "conflicting" | "missing";
    sources: string;
    connectedCircuits: string[];
    workbookRatingsKva: Array<number | null>;
    loadModelRatingKva: number | null;
  }>;
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
    exportLimit: { value: number; unit: "kW"; provenance: "scenario-assumption" };
    defaultExportCost: { gbpPerKva: number; provenance: "scenario-assumption" };
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
