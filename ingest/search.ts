import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dayBounds, defaultScenario, importLimit, londonDate } from "../lib/constraint";
import { loadLocalEnv } from "../lib/env";
import { fetchBetween, mergeAnalogSeries, threePhasePowerKw } from "../lib/nerda";
import type { CohortFeeder, Feeder, Snapshot } from "../lib/types";

loadLocalEnv();

type DayStat = { complete: number; events: number; exceedanceKwh: number };
type Cached = { start: string; end: string; feeders: Record<string, Record<string, DayStat>> };

async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  }));
}
function londonDays(start: Date, end: Date) {
  const days: string[] = [];
  for (let time = +start; time < +end; time += 86_400_000) {
    const day = londonDate(new Date(time + 12 * 3_600_000).toISOString());
    if (!days.includes(day)) days.push(day);
  }
  return days;
}

async function main() {
  const snapshot = await json<Snapshot>(path.join(process.cwd(), "data", "snapshot.json"));
  const cohort = await json<CohortFeeder[]>(path.join(process.cwd(), "cohort.json"));
  const selected = new Set(snapshot.feeders.map((feeder) => feeder.id));
  const feeders = cohort.filter((feeder) => selected.has(feeder.id));
  const end = new Date(process.env.SEARCH_END ?? "2026-10-01T00:00:00.000Z");
  const start = new Date(process.env.SEARCH_START ?? "2025-10-01T00:00:00.000Z");
  const days = londonDays(start, end);
  const file = path.join(process.cwd(), "data", "constraint-search-cache.json");
  let cache: Cached;
  try {
    cache = await json<Cached>(file);
    if (cache.start !== start.toISOString() || cache.end !== end.toISOString()) throw new Error("window changed");
  } catch {
    cache = { start: start.toISOString(), end: end.toISOString(), feeders: {} };
  }
  let writes = Promise.resolve();
  const save = () => {
    const body = JSON.stringify(cache);
    writes = writes.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, body);
      await rename(`${file}.tmp`, file);
    });
  };

  const missing = feeders.filter((feeder) => !cache.feeders[feeder.id]);
  let done = feeders.length - missing.length;
  await pool(missing, 4, async (feeder) => {
    const series = (
      await Promise.all(feeder.powerMeasurementIds.map((id) => fetchBetween(id, start, end)))
    ).flat();
    const points = threePhasePowerKw(mergeAnalogSeries(series), feeder.powerScaleToKw);
    const limit = importLimit(feeder as unknown as Pick<Feeder, "ratingKva" | "ratingSource">, defaultScenario);
    const stats: Record<string, DayStat> = {};
    for (const point of points) {
      if (point.t < start.toISOString() || point.t >= end.toISOString()) continue;
      const day = londonDate(point.t);
      const stat = stats[day] ?? { complete: 0, events: 0, exceedanceKwh: 0 };
      stat.complete++;
      if (point.value > limit) {
        stat.events++;
        stat.exceedanceKwh += (point.value - limit) * 0.5;
      }
      stats[day] = stat;
    }
    cache.feeders[feeder.id] = stats;
    done++;
    save();
    console.log(`${done}/${feeders.length} ${feeder.substationName}`);
  });
  await writes;

  const eligible = feeders.filter((feeder) =>
    days.filter((day) => (cache.feeders[feeder.id]?.[day]?.complete ?? 0) / dayBounds(day).buckets >= 0.9).length / days.length >= 0.9,
  );
  const ranked = days.flatMap((day) => {
    const complete = eligible.every((feeder) => (cache.feeders[feeder.id]?.[day]?.complete ?? 0) / dayBounds(day).buckets >= 0.9);
    if (!complete || !eligible.length) return [];
    let events = 0;
    let affected = 0;
    let exceedanceKwh = 0;
    for (const feeder of eligible) {
      const stat = cache.feeders[feeder.id][day];
      events += stat.events;
      exceedanceKwh += stat.exceedanceKwh;
      if (stat.events) affected++;
    }
    return [{ day, events, affected, exceedanceKwh }];
  }).sort((a, b) => b.events - a.events || b.affected - a.affected || b.exceedanceKwh - a.exceedanceKwh || a.day.localeCompare(b.day));
  const result = {
    generatedAt: new Date().toISOString(),
    window: { start: start.toISOString(), end: end.toISOString(), days: days.length },
    coverageRule: { feederDay: 0.9, feederSearchDays: 0.9 },
    feederCountRequested: feeders.length,
    eligibleFeederCount: eligible.length,
    status: eligible.length / feeders.length >= 0.9 ? "complete" : "insufficient-data",
    selectedDay: ranked[0]?.events ? ranked[0].day : null,
    ranked: ranked.filter((day) => day.events > 0).slice(0, 20),
  };
  await writeFile(path.join(process.cwd(), "data", "constraint-search-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
