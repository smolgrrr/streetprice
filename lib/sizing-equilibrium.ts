import { capitalRecoveryFactor, type PriceParameters } from "./price";

export type SizingPoint = {
  homes: number;
  capacityKw: number;
  tariffGbpPerKwh: number | null;
  dispatchedKwh: number;
  constrainedHours: number;
  annualAssetGbp: number;
  annualPaymentGbp: number;
  annualSavingGbp: number;
};

export type FeederSizingCurve = {
  baselinePeakKw: number;
  observedBuckets: number;
  expectedBuckets: number;
  points: SizingPoint[];
};

/** A feasible range of battery charge, in kWh, is carried across all recorded
 * half-hours. This avoids assuming a particular greedy charge schedule. */
export function capacityFeasible(loads: number[], capacityKw: number, homes: number, powerPerHomeKw = 10, energyPerHomeKwh = 25, efficiency = .95) {
  const power = homes * powerPerHomeKw;
  const energy = homes * energyPerHomeKwh;
  let least = energy, most = energy;
  for (const load of loads) {
    const minResponse = Math.max(-power, load - capacityKw);
    const maxResponse = Math.min(power, load + capacityKw);
    if (minResponse > maxResponse) return false;
    const nextLeast = least - maxResponse * .5 * (maxResponse >= 0 ? 1 / efficiency : efficiency);
    const nextMost = most - minResponse * .5 * (minResponse >= 0 ? 1 / efficiency : efficiency);
    if (nextLeast > energy + 1e-9 || nextMost < -1e-9) return false;
    least = Math.max(0, nextLeast);
    most = Math.min(energy, nextMost);
  }
  // A repeatable annual service cannot spend the initial full charge for free.
  return most >= energy - 1e-9;
}

/** Observed-year minimum feasible thermal size and an energy-only marginal
 * asset-value tariff. The price assumes the VPP will deliver whenever called. */
export function sizingCurve(loads: number[], expectedBuckets: number, parameters: PriceParameters, maxHomes = 60): FeederSizingCurve {
  if (!loads.length || loads.some(load => !Number.isFinite(load))) throw new Error("Finite observations required");
  const peak = Math.max(...loads.map(Math.abs));
  const annualPerKw = parameters.gbpPerKva * capitalRecoveryFactor(parameters.discountRate, parameters.lifeYears);
  const points: SizingPoint[] = [];
  for (let homes = 0; homes <= maxHomes; homes++) {
    let low = 0, high = peak;
    if (homes) {
      while (high - low > .05) {
        const middle = (low + high) / 2;
        if (capacityFeasible(loads, middle, homes)) high = middle;
        else low = middle;
      }
    }
    const capacityKw = homes ? Math.min(peak, Math.ceil(high * 10) / 10) : peak;
    const above = loads.map(load => Math.max(0, Math.abs(load) - capacityKw));
    const dispatchedKwh = above.reduce((sum, value) => sum + value * .5, 0);
    // d(required kWh)/d(capacity kW) is the number of constrained hours.
    const constrainedHours = above.filter(value => value > 1e-9).length * .5;
    const tariffGbpPerKwh = constrainedHours && homes ? annualPerKw / constrainedHours : null;
    const annualAssetGbp = capacityKw * annualPerKw;
    const annualPaymentGbp = tariffGbpPerKwh === null ? 0 : tariffGbpPerKwh * dispatchedKwh;
    points.push({ homes, capacityKw, tariffGbpPerKwh, dispatchedKwh, constrainedHours,
      annualAssetGbp, annualPaymentGbp,
      annualSavingGbp: peak * annualPerKw - annualAssetGbp - annualPaymentGbp });
  }
  return { baselinePeakKw: peak, observedBuckets: loads.length, expectedBuckets, points };
}
