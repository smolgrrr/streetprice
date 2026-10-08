export const priceParameters = {
  gbpPerKva: 80,
  lifeYears: 45,
  discountRate: 0.05,
  bindingHoursPerYear: 15,
} as const;

export type PriceParameters = {
  gbpPerKva: number;
  lifeYears: number;
  discountRate: number;
  bindingHoursPerYear: number;
};

export function capitalRecoveryFactor(rate: number, years: number): number {
  if (years <= 0) {
    throw new Error("lifeYears must be positive");
  }
  if (rate === 0) return 1 / years;
  const growth = (1 + rate) ** years;
  return (rate * growth) / (growth - 1);
}

/** £/MWh at which reinforcing the transformer is the cheaper option. */
export function capGbpPerMwh(parameters: PriceParameters = priceParameters): number {
  const annuityPerKva =
    parameters.gbpPerKva * capitalRecoveryFactor(parameters.discountRate, parameters.lifeYears);
  return (annuityPerKva * 1000) / parameters.bindingHoursPerYear;
}

/** Three-phase kVA from a line-current limit. Default voltage is 400 V. */
export function ratingKvaFromAmps(iLimitAmps: number, lineKv = 0.4): number {
  return Math.sqrt(3) * lineKv * iLimitAmps;
}

export function sumPhasePowerW(phaseWatts: number[]): number {
  return phaseWatts.reduce((sum, watts) => sum + watts, 0);
}

export function flatTargetKw(powerKw: number[]): number {
  if (powerKw.length === 0) return 0;
  let sum = 0;
  for (const value of powerKw) sum += value;
  return sum / powerKw.length;
}

/**
 * Add-on in £/MWh. Zero at the flat target. Saturates at ±cap when power
 * is half a rating away from the target, in either direction.
 */
export function addonGbpPerMwh(
  powerKw: number,
  targetKw: number,
  ratingKva: number,
  cap: number,
): number {
  if (!(ratingKva > 0) || !Number.isFinite(cap)) return 0;
  const gap = (powerKw - targetKw) / ratingKva;
  const scaled = Math.max(-1, Math.min(1, gap / 0.5));
  return scaled * cap;
}

export function localGbpPerMwh(wholesaleGbpPerMwh: number, addon: number): number {
  return wholesaleGbpPerMwh + addon;
}

/** Local price divided by wholesale. Null when wholesale is zero or either price is missing. */
export function localToWholesale(localGbpPerMwh: number, wholesaleGbpPerMwh: number): number | null {
  if (!Number.isFinite(localGbpPerMwh) || !Number.isFinite(wholesaleGbpPerMwh) || wholesaleGbpPerMwh === 0) {
    return null;
  }
  return localGbpPerMwh / wholesaleGbpPerMwh;
}

export function loadingRatio(powerKw: number, ratingKva: number): number {
  if (!(ratingKva > 0)) return 0;
  return Math.abs(powerKw) / ratingKva;
}

/** Hottest phase divided by the current rating. */
export function currentLoading(phaseAmps: number[], limitAmps: number): number {
  if (!(limitAmps > 0) || phaseAmps.length === 0) return 0;
  let hottest = 0;
  for (const amps of phaseAmps) hottest = Math.max(hottest, Math.abs(amps));
  return hottest / limitAmps;
}

export type PricedSample = {
  t: string;
  pKw: number;
  loading: number;
  limitKw: number;
  rampStartKw: number;
  direction: "import" | "export" | "neutral" | "unknown";
  addon: number;
  local: number;
  wholesale: number;
};

export function priceWindow(
  points: { t: string; pKw: number; loading?: number }[],
  wholesaleAt: (t: string) => number,
  asset: { ratingKva: number; ratingSource: RatingSource },
): PricedSample[] {
  return points.map((point) => {
    const importLimitKw = importLimit(asset, defaultScenario);
    const signal = constraintSignal(point.pKw, importLimitKw, defaultScenario);
    const limitKw = point.pKw < 0 ? defaultScenario.exportKw ?? importLimitKw : importLimitKw;
    const addon = (signal.price ?? 0) * 1000;
    const wholesale = wholesaleAt(point.t);
    return {
      t: point.t,
      pKw: point.pKw,
      loading: point.loading ?? signal.loading ?? 0,
      limitKw,
      rampStartKw: limitKw * defaultScenario.rampStart,
      direction: signal.direction,
      addon,
      local: localGbpPerMwh(wholesale, addon),
      wholesale,
    };
  });
}
import { constraintSignal, defaultScenario, importLimit } from "./constraint";
import type { RatingSource } from "./types";
