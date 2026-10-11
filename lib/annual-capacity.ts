import { dayBounds } from "./constraint";
import type { AnnualCapacity } from "./types";

const HALF_HOUR = 1_800_000;
const londonDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});
function londonDate(t: string) { return londonDayFormatter.format(new Date(t)); }
const dayCache = new Map<string, ReturnType<typeof dayBounds>>();
function boundsFor(day: string) {
  const saved = dayCache.get(day);
  if (saved) return saved;
  const bounds = dayBounds(day);
  dayCache.set(day, bounds);
  return bounds;
}

/** Most recent completed half-hour, then 24 hours back. Never future buckets. */
export function previous24Hours(now = new Date()) {
  const end = Math.floor(now.getTime() / HALF_HOUR) * HALF_HOUR;
  return { start: new Date(end - 86_400_000), end: new Date(end) };
}

/** Twelve calendar months of complete London days, ending before the display end. */
export function annualWindow(displayEnd: Date) {
  const lastDay = londonDate(displayEnd.toISOString());
  const [year, month, day] = lastDay.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year - 1, month - 1,
    Math.min(day, new Date(Date.UTC(year - 1, month, 0)).getUTCDate()))).toISOString().slice(0, 10);
  return { start: new Date(boundsFor(firstDay).start), end: new Date(boundsFor(lastDay).start) };
}

export function daysInWindow(start: Date, end: Date) {
  const days: string[] = [];
  let day = londonDate(start.toISOString());
  while (boundsFor(day).start < end.getTime()) {
    const bounds = boundsFor(day);
    if (bounds.start >= start.getTime() && bounds.end <= end.getTime()) days.push(day);
    day = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return days;
}

export type DailyMaxima = { buckets: number; importKw: number; exportKw: number };

/** Already-aggregated, complete-three-phase half-hours; duplicates are not coverage. */
export function dailyMaxima(points: Array<{ t: string; value: number }>, start: Date, end: Date) {
  const days: Record<string, DailyMaxima> = {};
  const unique = new Map(points.filter(p => Number.isFinite(p.value)
    && Date.parse(p.t) >= +start && Date.parse(p.t) < +end).map(p => [p.t, p]));
  for (const point of unique.values()) {
    const day = londonDate(point.t);
    const stat = days[day] ?? { buckets: 0, importKw: 0, exportKw: 0 };
    stat.buckets++;
    stat.importKw = Math.max(stat.importKw, point.value);
    stat.exportKw = Math.max(stat.exportKw, -point.value);
    days[day] = stat;
  }
  return days;
}

export const annualCoverageRule = { day: .5, year: .9, month: .75 };

/** Mean OBSERVED daily maxima, not inferred true peaks. No-export days count as
 * zero; missing days do not. Require coverage across all twelve seasons. */
export function annualCapacity(days: Record<string, DailyMaxima>, start: Date, end: Date): AnnualCapacity {
  const expected = daysInWindow(start, end);
  const eligibleDays = expected.filter(day => {
    const stat = days[day];
    return stat && stat.buckets >= Math.ceil(boundsFor(day).buckets * annualCoverageRule.day);
  });
  const eligible = eligibleDays.map(day => days[day]);
  const coverage = expected.length ? eligible.length / expected.length : 0;
  const eligibleSet = new Set(eligibleDays);
  const months = [...new Set(expected.map(day => day.slice(0, 7)))];
  const seasonalCoverage = months.every(month => {
    const monthDays = expected.filter(day => day.startsWith(month));
    return monthDays.filter(day => eligibleSet.has(day)).length / monthDays.length >= annualCoverageRule.month;
  });
  const ready = expected.length >= 365 && coverage >= annualCoverageRule.year && seasonalCoverage;
  const meanImport = ready ? eligible.reduce((sum, day) => sum + day.importKw, 0) / eligible.length : null;
  const meanExport = ready ? eligible.reduce((sum, day) => sum + day.exportKw, 0) / eligible.length : null;
  const assetKw = ready ? eligible.reduce((sum, day) => sum + Math.max(day.importKw, day.exportKw), 0) / eligible.length : null;
  return { status: ready ? "ready" : "insufficient", meanDailyMaxImportKw: meanImport,
    meanDailyMaxExportKw: meanExport, assetKw,
    coveredDays: eligible.length, totalDays: expected.length, coverage };
}
