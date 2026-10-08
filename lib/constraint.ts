import type { Feeder } from "./types";

/** Scenario inputs, not an operational tariff or measured asset limits. */
export type Scenario = {
  rampStart: number;
  importAmps: number;
  powerFactor: number;
  importCost: number;
  exportKw: number | null;
  exportCost: number | null;
  lifeYears: number;
  discountRate: number;
  bindingHours: number;
};
export const defaultScenario: Scenario = {
  rampStart: .85, importAmps: 200, powerFactor: 1, importCost: 80,
  exportKw: 100, exportCost: 40, lifeYears: 45, discountRate: .05, bindingHours: 15,
};
function capitalRecoveryFactor(rate: number, years: number) {
  if (rate === 0) return 1 / years;
  const growth = (1 + rate) ** years;
  return rate * growth / (growth - 1);
}
function ratingKvaFromAmps(amps: number) {
  return Math.sqrt(3) * 0.4 * amps;
}
export function validateScenario(s: Scenario) {
  if (![s.rampStart,s.importAmps,s.powerFactor,s.importCost,s.lifeYears,s.discountRate,s.bindingHours].every(Number.isFinite)
    || s.rampStart < 0 || s.rampStart >= 1 || s.importAmps <= 0 || s.powerFactor <= 0 || s.powerFactor > 1
    || s.importCost < 0 || s.lifeYears <= 0 || s.discountRate < 0 || s.bindingHours <= 0
    || (s.exportKw !== null && (!Number.isFinite(s.exportKw) || s.exportKw <= 0))
    || (s.exportCost !== null && (!Number.isFinite(s.exportCost) || s.exportCost < 0))) throw new Error("Invalid scenario inputs");
}
/** £/kVA/year ÷ kW/kVA ÷ binding hours/year = £/kWh. */
export function signalCap(cost: number, s: Scenario) {
  validateScenario(s);
  return cost * capitalRecoveryFactor(s.discountRate, s.lifeYears) / s.powerFactor / s.bindingHours;
}
export function ramp(loading: number, start: number) {
  return Math.max(0, Math.min(1, (loading - start) / (1 - start)));
}
export function importLimit(feeder: Pick<Feeder,"ratingKva"|"ratingSource">, s: Scenario) {
  return (feeder.ratingSource === "amps" || feeder.ratingSource === "kva"
    ? feeder.ratingKva : ratingKvaFromAmps(s.importAmps)) * s.powerFactor;
}
export type Signal = {
  loading: number | null; importPrice: number; exportPrice: number | null;
  price: number | null; direction: "import" | "export" | "neutral" | "unknown";
  constrained: boolean | null;
};
export function constraintSignal(power: number, limitKw: number, s: Scenario): Signal {
  validateScenario(s);
  if (!Number.isFinite(power) || !(limitKw > 0)) return {loading:null,importPrice:0,exportPrice:null,price:null,direction:"unknown",constrained:null};
  if (power < 0) {
    if (s.exportKw === null) return {loading:null,importPrice:0,exportPrice:null,price:null,direction:"unknown",constrained:null};
    const loading = -power / s.exportKw;
    const exportPrice = s.exportCost === null ? null : -signalCap(s.exportCost,s) * ramp(loading,s.rampStart);
    return {loading,importPrice:0,exportPrice,price:exportPrice,direction:loading > s.rampStart ? "export" : "neutral",constrained:loading > 1};
  }
  const loading = power / limitKw;
  const importPrice = signalCap(s.importCost,s) * ramp(loading,s.rampStart);
  return {loading,importPrice,exportPrice:0,price:importPrice,direction:loading > s.rampStart ? "import" : "neutral",constrained:loading > 1};
}
export function signalColor(signal: Signal | null, layer: "pressure" | "price", cap: number) {
  if (!signal) return "#939ba5";
  if (signal.loading === null || (layer === "price" && signal.price === null)) return "#9d77ae";
  const strength = layer === "pressure" ? ramp(signal.loading,.5) : Math.min(1,Math.abs(signal.price ?? 0) / Math.max(cap,.001));
  const end = signal.direction === "export" ? [49,95,211] : [221,59,31];
  return `rgb(${end.map(v=>Math.round(218+(v-218)*strength)).join(",")})`;
}
export const londonDate = (t: string) => new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(t));
/** UTC bounds from London midnight, including 46/50-bucket DST days. */
export function dayBounds(day: string) {
  const date = Date.parse(`${day}T00:00:00Z`);
  const midnight = (utc: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London",hourCycle:"h23",hour:"2-digit"}).format(new Date(utc));
    return utc - Number(parts) * 3600000;
  };
  const start = midnight(date), end = midnight(date + 86400000);
  return {start,end,buckets:(end-start)/1800000};
}
export type Observation = {t:string;pKw:number};
export function rankDays(feeders: Array<Pick<Feeder,"id"|"ratingKva"|"ratingSource"> & {samples:Observation[]}>, days:string[], s:Scenario) {
  const grouped = new Map<string,Map<string,Observation[]>>();
  for (const f of feeders) {
    const map = new Map<string,Observation[]>();
    const unique = new Map(f.samples.filter(p=>Number.isFinite(p.pKw)).map(p=>[p.t,p]));
    for (const p of unique.values()) { const day=londonDate(p.t); map.set(day,[...(map.get(day)??[]),p]); }
    grouped.set(f.id,map);
  }
  const eligible = feeders.filter(f=>days.length > 0 && days.filter(d=>(grouped.get(f.id)?.get(d)?.length??0)/dayBounds(d).buckets >= .9).length/days.length >= .9);
  const ranked = days.flatMap(day=>{
    const expected = dayBounds(day).buckets;
    // Same cohort on every ranked day; do not reward days with missing feeders.
    if (!eligible.length || eligible.some(f=>(grouped.get(f.id)?.get(day)?.length??0)/expected < .9)) return [];
    let events=0,affected=0,exceedanceKwh=0;
    for (const f of eligible) {
      let count=0;
      for (const p of grouped.get(f.id)!.get(day)!) {
        const limit=p.pKw < 0 ? s.exportKw : importLimit(f,s);
        if (limit !== null && Math.abs(p.pKw)>limit) { count++; exceedanceKwh+=(Math.abs(p.pKw)-limit)*.5; }
      }
      events+=count; if(count) affected++;
    }
    return [{day,events,affected,exceedanceKwh}];
  }).sort((a,b)=>b.events-a.events || b.affected-a.affected || b.exceedanceKwh-a.exceedanceKwh || a.day.localeCompare(b.day));
  return {cohort:eligible.map(f=>f.id),ranked,winner:ranked[0]?.events ? ranked[0] : null};
}

export type CadenceDayStat = { complete: number; pressureSum: number; affected: boolean };
export type CadenceSearchFeeder = { id: string; days: Record<string, CadenceDayStat> };

export function expectedDailySamples(counts: number[]): number {
  if (!counts.length) return 1;
  const sorted = [...counts].sort((a, b) => a - b);
  return Math.max(1, sorted[Math.floor((sorted.length - 1) * 0.9)]);
}

export function rankCadenceDays(feeders: CadenceSearchFeeder[], days: string[]) {
  const expected = new Map(feeders.map((feeder) => [
    feeder.id,
    expectedDailySamples(days.map((day) => feeder.days[day]?.complete ?? 0)),
  ]));
  const expectedFor = (feederId: string, day: string) =>
    Math.max(1, Math.round((expected.get(feederId) ?? 1) * dayBounds(day).buckets / 48));
  return days.flatMap((day) => {
    const covered = feeders.filter((feeder) =>
      (feeder.days[day]?.complete ?? 0) / expectedFor(feeder.id, day) >= 0.9,
    );
    const coverage = covered.length / Math.max(1, feeders.length);
    if (coverage < 0.75) return [];
    const hours = dayBounds(day).buckets / 2;
    let pressureHours = 0;
    let affected = 0;
    for (const feeder of covered) {
      const stat = feeder.days[day];
      pressureHours += stat.pressureSum * hours / expectedFor(feeder.id, day);
      if (stat.affected) affected++;
    }
    return [{
      day,
      averagePressureHours: pressureHours / covered.length,
      affectedShare: affected / covered.length,
      coveredFeeders: covered.length,
      coverage,
    }];
  }).sort((a, b) =>
    b.averagePressureHours - a.averagePressureHours ||
    b.affectedShare - a.affectedShare ||
    b.coverage - a.coverage ||
    a.day.localeCompare(b.day),
  );
}
