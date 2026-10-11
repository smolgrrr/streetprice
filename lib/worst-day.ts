import { dayBounds, defaultScenario, importLimit } from "./constraint";
import type { AnnualCapacityModel, Feeder, WorstDay } from "./types";
import { simulateFlexibility, type BatteryScenario } from "./flexibility";
import type { AnnualCapacity } from "./types";

/** Dispatch in the historical day's true order before aligning its clock times. */
export function simulateWorstDay(feeder: Feeder, day: WorstDay, config: BatteryScenario, annual: AnnualCapacity) {
  const bounds = dayBounds(day.date);
  const clock = Array.from({ length: bounds.buckets }, (_, i) => new Date(bounds.start + i * 1800000).toISOString());
  const template = feeder.samples[0];
  const historical = { ...feeder, samples: day.samples.map(s => ({ ...template, t: s.t, pKw: s.value, wholesale: 0 })) };
  return simulateFlexibility(historical, clock, config, 200, annual, "limit");
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Highest observed directional loading, not the day with greatest energy. */
export function worstObservedDay(points: Array<{ t: string; value: number }>, start: Date, end: Date, importKw: number, exportKw: number): WorstDay | null {
  const groups = new Map<string, Array<{ t: string; value: number }>>();
  const unique = new Map(points.filter(p => Number.isFinite(p.value) && Date.parse(p.t) >= +start && Date.parse(p.t) < +end).map(p => [p.t, p]));
  for (const point of unique.values()) {
    const date = dateFormatter.format(new Date(point.t));
    const samples = groups.get(date) ?? [];
    samples.push(point);
    groups.set(date, samples);
  }
  let worst: WorstDay | null = null;
  for (const [date, samples] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const bounds = dayBounds(date);
    if (bounds.start < +start || bounds.end > +end || samples.length < Math.ceil(bounds.buckets * .5)) continue;
    const peakLoading = Math.max(...samples.map(p => Math.abs(p.value) / (p.value < 0 ? exportKw : importKw)));
    if (!worst || peakLoading > worst.peakLoading) worst = {
      date, peakLoading, expectedBuckets: bounds.buckets,
      samples: samples.sort((a, b) => a.t.localeCompare(b.t)),
    };
  }
  return worst;
}

/** Overlay London clock time; gaps and ambiguous repeated DST times stay gaps. */
export function alignWorstDay(day: WorstDay | null | undefined, clock: string[]) {
  const byTime = new Map<string, number | null>();
  for (const sample of day?.samples ?? []) {
    const time = timeFormatter.format(new Date(sample.t));
    byTime.set(time, byTime.has(time) ? null : sample.value);
  }
  return clock.map(t => byTime.get(timeFormatter.format(new Date(t))) ?? null);
}

/** An annual near-limit example, without picking an unusually loaded current day. */
export function openingFeeder(feeders: Feeder[], annual?: AnnualCapacityModel, importAmps = 200, clock?: string[]) {
  const complete = feeders.filter(f => {
    const readings = new Set(f.samples.filter(s => Number.isFinite(s.pKw)).map(s => s.t));
    if (clock) return clock.length === 48 && clock.every(t => readings.has(t));
    const times = [...readings].map(Date.parse).sort((a, b) => a - b);
    return times.length === 48 && times.every((t, i) => i === 0 || t - times[i - 1] === 1800000);
  });
  const available = complete.length ? complete : feeders;
  const withHistory = available.filter(f => f.samples.some(s => Number.isFinite(s.pKw))
    && annual?.feeders[f.id]?.status === "ready" && annual.feeders[f.id].worstDay);
  const candidates = withHistory.length ? withHistory : available;
  const loading = (f: Feeder) => {
    const history = annual?.feeders[f.id];
    if (withHistory.length) return history!.worstDay!.peakLoading;
    const limit = importLimit(f, { ...defaultScenario, importAmps });
    return f.samples.length ? Math.max(...f.samples.map(s => Math.abs(s.pKw) / (s.pKw < 0 ? defaultScenario.exportKw! : limit))) : NaN;
  };
  return [...candidates].sort((a, b) => {
    const distance = (f: Feeder) => Number.isFinite(loading(f)) ? Math.abs(loading(f) - 1) : Infinity;
    return distance(a) - distance(b) || a.id.localeCompare(b.id);
  })[0];
}
