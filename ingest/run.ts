import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareFeeders, qualityFor } from "../lib/comparison";
import { dayBounds } from "../lib/constraint";
import { ASSUMED_FUSE_AMPS } from "../lib/cohort";
import { fetchMarketIndex, wholesaleAt } from "../lib/elexon";
import { loadLocalEnv } from "../lib/env";
import {
  fetchBetween,
  mergeAnalogSeries,
  NerdaAuthError,
  threePhasePowerKw,
  type AnalogSeries,
} from "../lib/nerda";
import { capGbpPerMwh, priceParameters, priceWindow } from "../lib/price";
import { streetLayout } from "../lib/street-trace";
import type { CohortFeeder, Feeder, Snapshot } from "../lib/types";

loadLocalEnv();

const HOUR = 60 * 60 * 1000;
const HALF_HOUR = 30 * 60 * 1000;
const DEFAULT_WINDOW_START = "2026-09-29T00:00:00.000Z";

async function paged(measurementId: string, after: Date, before: Date): Promise<AnalogSeries[]> {
  const pages: AnalogSeries[] = [];
  let cursor = after.getTime();
  const end = before.getTime();
  while (cursor < end) {
    const next = Math.min(end, cursor + 6 * HOUR);
    pages.push(...(await fetchBetween(measurementId, new Date(cursor), new Date(next))));
    cursor = next;
  }
  return mergeAnalogSeries(pages);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function withRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (error instanceof NerdaAuthError) throw error;
      last = error;
      const wait = 1000 * (attempt + 1);
      console.log(`retry ${attempt + 1} ${label}: ${error instanceof Error ? error.message : "request failed"}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw last instanceof Error ? last : new Error(`${label} failed`);
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  const cohortFile = path.join(process.cwd(), "cohort.json");
  const discovered = await readJson<CohortFeeder[]>(cohortFile);
  if (!discovered || discovered.length === 0) {
    throw new Error("cohort.json has no feeders. Run npm run discover.");
  }

  const previous = await readJson<Snapshot>(path.join(process.cwd(), "data", "snapshot.json"));
  const selectedIds = new Set(previous?.feeders.map((feeder) => feeder.id) ?? []);
  const cohort = selectedIds.size
    ? discovered.filter((feeder) => selectedIds.has(feeder.id))
    : discovered;
  const search = await readJson<{ selectedDay: string | null }>(path.join(process.cwd(), "data", "constraint-search-result.json"));

  const selectedStart = search?.selectedDay
    ? new Date(dayBounds(search.selectedDay).start).toISOString()
    : DEFAULT_WINDOW_START;
  const start = new Date(process.env.NERDA_WINDOW_START ?? selectedStart);
  if (Number.isNaN(start.getTime())) throw new Error("NERDA_WINDOW_START is not a valid timestamp");
  const end = search?.selectedDay && !process.env.NERDA_WINDOW_START
    ? new Date(dayBounds(search.selectedDay).end)
    : new Date(start.getTime() + 24 * HOUR);
  const expectedBuckets = Math.round((end.getTime() - start.getTime()) / HALF_HOUR);
  const cacheFile = path.join(process.cwd(), "data", "ingest-cache.json");
  const cached = await readJson<{ windowStart: string; windowEnd: string; feeders: Record<string, Feeder> }>(cacheFile);
  const cache =
    cached && cached.windowStart === start.toISOString() && cached.windowEnd === end.toISOString()
      ? cached
      : { windowStart: start.toISOString(), windowEnd: end.toISOString(), feeders: {} as Record<string, Feeder> };
  const missing = cohort.filter((row) => !cache.feeders[row.id]);
  const wholesale = missing.length > 0 ? await fetchMarketIndex(start, end) : [];
  if (missing.length > 0 && wholesale.length === 0) {
    throw new Error("Elexon returned no wholesale prices for the Oxford window");
  }

  const cap = capGbpPerMwh();
  let writing = Promise.resolve();
  const remember = (feeder: Feeder) => {
    cache.feeders[feeder.id] = feeder;
    const body = JSON.stringify(cache);
    writing = writing.then(async () => {
      await mkdir(path.dirname(cacheFile), { recursive: true });
      const temporary = `${cacheFile}.tmp`;
      await writeFile(temporary, body);
      await rename(temporary, cacheFile);
    });
  };

  try {
    await mapPool(cohort, 6, async (row, index) => {
      const saved = cache.feeders[row.id];
      if (saved) {
        if ((index + 1) % 25 === 0) console.log(`${index + 1}/${cohort.length} cached`);
        return;
      }
      console.log(`${index + 1}/${cohort.length} ${row.substationName} ${row.name}`);
      const analogs = (
        await Promise.all(
          row.powerMeasurementIds.map((id) => withRetry(id, () => paged(id, start, end))),
        )
      ).flat();
      const points = threePhasePowerKw(mergeAnalogSeries(analogs), row.powerScaleToKw).filter(
        (point) => point.t >= start.toISOString() && point.t < end.toISOString(),
      );
      const quality = qualityFor(points.length, expectedBuckets);
      remember({
        id: row.id,
        name: row.name,
        substationId: row.substationId,
        substationName: row.substationName,
        lat: row.lat,
        lon: row.lon,
        ratingKva: row.ratingKva,
        ratingSource: row.ratingSource,
        quality,
        samples: priceWindow(
          points.map((point) => ({ t: point.t, pKw: point.value })),
          (t) => wholesaleAt(wholesale, t),
          row,
        ),
      });
    });
  } catch (error) {
    await writing;
    if (error instanceof NerdaAuthError) {
      throw new Error(`${error.message}. The previous local snapshot was left in place.`);
    }
    throw error;
  }
  await writing;

  const fetched = cohort.flatMap((row) => {
    const feeder = cache.feeders[row.id];
    return feeder ? [feeder] : [];
  });
  const feeders = fetched;
  const incomplete = feeders.filter((feeder) => feeder.quality.status === "insufficient").length;
  console.log(`Kept all ${feeders.length} feeders; ${incomplete} have insufficient coverage and remain visible as missing.`);
  const dataThrough = feeders
    .flatMap((feeder) => feeder.samples.map((sample) => sample.t))
    .sort()
    .at(-1);
  if (!dataThrough) throw new Error("No feeder in the Oxford area had enough complete three-phase buckets");

  const streetFile = path.join(process.cwd(), "data", "street-network.json");
  const streetNetwork = await readJson<{ ways: Array<{ coords: [number, number][] }> }>(streetFile);
  if (!streetNetwork || streetNetwork.ways.length === 0) {
    throw new Error("data/street-network.json is missing. Run npm run streets. The previous snapshot was left in place.");
  }
  const streets = streetLayout(
    feeders.map((feeder) => ({
      id: feeder.id,
      substationId: feeder.substationId,
      lat: feeder.lat,
      lon: feeder.lon,
    })),
    streetNetwork.ways,
  );
  console.log(`Traced ${streets.traces.length} feeders along nearby streets. ${feeders.length - new Set(streets.traces.map((trace) => trace.feederId)).size} have a dot only.`);

  const snapshot: Snapshot = {
    updatedAt: new Date().toISOString(),
    source: "nerda-historical",
    mode: "historical",
    window: { start: start.toISOString(), end: end.toISOString(), dataThrough },
    capGbpPerMwh: cap,
    ratingAssumptionAmps: ASSUMED_FUSE_AMPS,
    parameters: { ...priceParameters },
    comparison: compareFeeders(feeders),
    feeders,
    streets,
  };
  const snapshotFile = path.join(process.cwd(), "data", "snapshot.json");
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await writeFile(snapshotFile, JSON.stringify(snapshot));
  console.log(`Wrote ${feeders.length} historical feeders to ${snapshotFile}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ingest failed");
  process.exitCode = 1;
});
