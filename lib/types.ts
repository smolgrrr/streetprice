import type { PriceParameters, PricedSample } from "./price";

export type RatingSource = "amps" | "kva" | "assumed-transformer-share";

export type Feeder = {
  id: string;
  name: string;
  substationId: string;
  substationName: string;
  lat: number;
  lon: number;
  ratingKva: number;
  ratingSource: RatingSource;
  samples: PricedSample[];
};

export type Snapshot = {
  updatedAt: string;
  source: "fixture" | "nerda";
  capGbpPerMwh: number;
  parameters: PriceParameters;
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
