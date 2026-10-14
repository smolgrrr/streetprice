import { capitalRecoveryFactor, type PriceParameters } from "./price";
import { constraintSignal, defaultScenario, importLimit } from "./constraint";
import type { AnnualCapacity, Feeder } from "./types";

export type BatteryScenario = {
  households: number;
  powerPerHomeKw: number;
  energyPerHomeKwh: number;
  efficiency: number;
  targetLoading: number;
};

export const batteryDefaults: BatteryScenario = {
  households: 20, powerPerHomeKw: 10, energyPerHomeKwh: 25,
  efficiency: 0.95, targetLoading: 0.8,
};

export type ViewScenario = "none" | "battery";

// Scenario assumption only: the monitored dataset has no household counts.
export const assumedHouseholdsPerFeeder = 60;
export function batteryHomesForShare(percent: number) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error("Invalid battery household percentage");
  return Math.round(assumedHouseholdsPerFeeder * percent / 100);
}

export function simulateFlexibility(feeder: Feeder, clock: string[], config: BatteryScenario, importAmps = 200, futureCapacity?: AnnualCapacity | null, dispatch: "headroom" | "limit" = "headroom") {
  if (!Number.isInteger(config.households) || config.households < 0
    || !(config.powerPerHomeKw > 0) || !(config.energyPerHomeKwh > 0)
    || !(config.efficiency > 0 && config.efficiency <= 1)
    || !(config.targetLoading > 0 && config.targetLoading < defaultScenario.rampStart)) {
    throw new Error("Invalid battery scenario");
  }
  const scenario = { ...defaultScenario, importAmps };
  const referenceImportKw = importLimit(feeder, scenario);
  const sizingAvailable = futureCapacity === undefined || (futureCapacity?.status === "ready"
    && Number.isFinite(futureCapacity.assetKw) && futureCapacity.assetKw! > 0);
  // A cable/transformer carries both directions: average each day's largest
  // import/export magnitude. This is not an export permission or current rating.
  const importKw = futureCapacity !== undefined && sizingAvailable ? futureCapacity!.assetKw! : referenceImportKw;
  const exportKw = futureCapacity !== undefined && sizingAvailable ? importKw : scenario.exportKw!;
  const capacityScale = importKw / referenceImportKw;
  scenario.exportKw = exportKw;
  const capacity = config.households * config.energyPerHomeKwh;
  const power = config.households * config.powerPerHomeKw;
  const triggerLoading = dispatch === "limit" ? 1 : scenario.rampStart;
  const targetLoading = dispatch === "limit" ? 1 : config.targetLoading;
  // Explicit starting condition, not free energy credited as a saving.
  let stored = capacity;
  const byTime = new Map(feeder.samples.map((sample) => [sample.t, sample]));
  const rows = clock.map((t) => {
    const sample = byTime.get(t);
    if (!sample || !Number.isFinite(sample.pKw)) return null;
    const baseline = sample.pKw;
    let batteryKw = 0;
    if (sizingAvailable && baseline > importKw * triggerLoading) {
      batteryKw = Math.min(power, baseline - importKw * targetLoading, stored * config.efficiency / 0.5);
      stored -= batteryKw * 0.5 / config.efficiency;
    } else if (sizingAvailable && baseline < -exportKw * triggerLoading) {
      const charge = Math.min(power, -exportKw * targetLoading - baseline, (capacity - stored) / config.efficiency / 0.5);
      batteryKw = -charge;
      stored += charge * 0.5 * config.efficiency;
    } else if (sizingAvailable && baseline < importKw * 0.75) {
      // Recharge in quieter intervals without exceeding the selected target.
      const charge = Math.min(power, Math.max(0, importKw * targetLoading - baseline), (capacity - stored) / config.efficiency / 0.5);
      batteryKw = -charge;
      stored += charge * 0.5 * config.efficiency;
    }
    stored = Math.max(0, Math.min(capacity, stored));
    const signal = constraintSignal(sizingAvailable ? baseline : NaN, importKw, scenario);
    const payment = Math.max(0, batteryKw) * Math.max(0, signal.price ?? 0) * 0.5
      + Math.max(0, -batteryKw) * Math.max(0, -(signal.price ?? 0)) * 0.5;
    return { t, baseline, net: baseline - batteryKw, batteryKw, storedKwh: stored, payment,
      signalPerKwh: signal.price ?? 0, wholesalePerKwh: sample.wholesale / 1000 };
  });
  const available = rows.filter((row) => row !== null);
  const baselinePeak = available.length ? Math.max(0, ...available.map((row) => row.baseline)) : null;
  const netPeak = available.length ? Math.max(0, ...available.map((row) => row.net)) : null;
  const baselineExportPeak = available.length ? Math.max(0, ...available.map(row => -row.baseline)) : null;
  const netExportPeak = available.length ? Math.max(0, ...available.map(row => -row.net)) : null;
  const payment = available.reduce((sum, row) => sum + row.payment, 0);
  const responseHours = available.filter((row) => row.payment > 0).length * 0.5;
  const energy = available.reduce((sum, row) => sum + Math.max(0, row.batteryKw) * 0.5, 0);
  const mean = available.length ? available.reduce((sum, row) => sum + row.baseline, 0) / available.length : 0;
  const netMean = available.length ? available.reduce((sum, row) => sum + row.net, 0) / available.length : 0;
  return { rows, importKw, referenceImportKw, capacityScale, exportKw, capacity, power, baselinePeak, netPeak,
    baselineExportPeak, netExportPeak, annualCapacity: futureCapacity ?? null, sizingAvailable, payment, responseHours, energy,
    complete: available.length === clock.length && clock.length > 0,
    baselineLoadFactor: baselinePeak ? mean / baselinePeak : null,
    netLoadFactor: netPeak ? netMean / netPeak : null,
    finalStoredKwh: stored };
}

export type FlexResult = ReturnType<typeof simulateFlexibility>;

/** Same annual basis on both sides. Linear scenario costs, not a quoted project
 * cost or an SSEN allowed-revenue forecast. Gross payments exclude energy/capex. */
export function flexibilityEconomics(result: FlexResult, parameters: PriceParameters) {
  const annuity = parameters.gbpPerKva * capitalRecoveryFactor(parameters.discountRate, parameters.lifeYears);
  const baselinePeak = result.annualCapacity ? Math.max(result.baselinePeak ?? 0, result.baselineExportPeak ?? 0) : result.baselinePeak ?? 0;
  const netPeak = result.annualCapacity ? Math.max(result.netPeak ?? 0, result.netExportPeak ?? 0) : result.netPeak ?? 0;
  const baselineExtra = Math.max(0, baselinePeak - result.referenceImportKw);
  const netExtra = Math.max(0, netPeak - result.importKw);
  const existing = result.importKw * annuity;
  const withoutExisting = result.referenceImportKw * annuity;
  const withoutUpgrade = baselineExtra * annuity;
  const withUpgrade = netExtra * annuity;
  const payments = result.responseHours ? result.payment / result.responseHours * parameters.bindingHoursPerYear : 0;
  const releasedKw = Math.max(0, baselinePeak - netPeak);
  const avoidedCapital = Math.max(0, result.referenceImportKw + baselineExtra - result.importKw - netExtra) * parameters.gbpPerKva;
  const deferralYears = result.complete && baselineExtra > 0 && result.netPeak && result.netPeak < result.importKw
    ? Math.max(0, Math.log(result.importKw / result.netPeak) / Math.log(1.02)) : null;
  return { existing, withoutExisting, withoutUpgrade, withUpgrade, payments, releasedKw, avoidedCapital, deferralYears,
    withoutTotal: withoutExisting + withoutUpgrade, withTotal: existing + withUpgrade + payments,
    avoidedAnnualUpgrade: withoutUpgrade - withUpgrade };
}
