import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchMarketIndex, wholesaleAt, type WholesalePoint } from "../lib/elexon";
import { loadLocalEnv } from "../lib/env";
import { fetchBetween, NerdaAuthError, type HistoryPoint } from "../lib/nerda";
import { capGbpPerMwh, currentLoading, priceParameters, priceWindow } from "../lib/price";
import type { CohortFeeder, Feeder, Snapshot } from "../lib/types";

loadLocalEnv();

const HOUR = 60 * 60 * 1000;
const KEEP_MS = 26 * HOUR;

function byTime(points: HistoryPoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const point of points) map.set(point.t, point.value);
  return map;
}

async function paged(measurementId: string, after: Date, before: Date): Promise<HistoryPoint[]> {
  const points: HistoryPoint[] = [];
  let cursor = after.getTime();
  const end = before.getTime();
  while (cursor < end) {
    const next = Math.min(end, cursor + 6 * HOUR);
    const page = await fetchBetween(measurementId, new Date(cursor), new Date(next));
    points.push(...page);
    cursor = next;
  }
  return [...byTime(points)].map(([t, value]) => ({ t, value })).sort((a, b) => a.t.localeCompare(b.t));
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const cohortFile = path.join(process.cwd(), "cohort.json");
  const cohort = await readJson<CohortFeeder[]>(cohortFile);
  if (!cohort || cohort.length === 0) {
    console.log("No cohort.json yet. The site keeps serving the worked example.");
    return;
  }

  const snapshotFile = path.join(process.cwd(), "data", "snapshot.json");
  const previous = await readJson<Snapshot>(snapshotFile);
  const now = new Date();
  const backfill = !previous || previous.source !== "nerda";
  const after = new Date(now.getTime() - (backfill ? KEEP_MS : 30 * 60 * 1000));

  let wholesale: WholesalePoint[];
  try {
    wholesale = await fetchMarketIndex(new Date(now.getTime() - KEEP_MS), now);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Elexon request failed");
    process.exitCode = 1;
    return;
  }

  const cap = capGbpPerMwh();
  const feeders: Feeder[] = [];

  try {
    for (const row of cohort) {
      const powerSeries = await Promise.all(
        row.powerMeasurementIds.map((id) => paged(id, after, now)),
      );
      const currentSeries = await Promise.all(
        row.currentMeasurementIds.map((id) => paged(id, after, now)),
      );
      const fresh = align(row, powerSeries, currentSeries);
      const prior =
        previous?.feeders.find((feeder) => feeder.id === row.id)?.samples.map((sample) => ({
          t: sample.t,
          pKw: sample.pKw,
          loading: sample.loading,
        })) ?? [];
      const merged = mergeSamples(prior, fresh, now.getTime() - KEEP_MS);
      feeders.push({
        id: row.id,
        name: row.name,
        substationId: row.substationId,
        substationName: row.substationName,
        lat: row.lat,
        lon: row.lon,
        ratingKva: row.ratingKva,
        ratingSource: row.ratingSource,
        samples: priceWindow(merged, (t) => wholesaleAt(wholesale, t), row.ratingKva, cap),
      });
    }
  } catch (error) {
    if (error instanceof NerdaAuthError) {
      console.error(error.message);
      console.error("Left the previous snapshot in place.");
    } else {
      console.error(error instanceof Error ? error.message : "Ingest failed");
    }
    process.exitCode = 1;
    return;
  }

  const snapshot: Snapshot = {
    updatedAt: now.toISOString(),
    source: "nerda",
    capGbpPerMwh: cap,
    parameters: { ...priceParameters },
    feeders,
  };
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await writeFile(snapshotFile, JSON.stringify(snapshot));
  console.log(`Wrote ${feeders.length} feeders to ${snapshotFile}.`);
}

function align(
  row: CohortFeeder,
  powerSeries: HistoryPoint[][],
  currentSeries: HistoryPoint[][],
): { t: string; pKw: number; loading: number }[] {
  const powerMaps = powerSeries.map(byTime);
  const times = new Set<string>();
  for (const map of powerMaps) {
    for (const t of map.keys()) times.add(t);
  }
  const currentMaps = currentSeries.map(byTime);
  const samples: { t: string; pKw: number; loading: number }[] = [];
  for (const t of [...times].sort()) {
    if (powerMaps.some((map) => !map.has(t))) continue;
    const watts = powerMaps.map((map) => map.get(t) ?? 0);
    const pKw = watts.reduce((sum, value) => sum + value, 0) * row.powerScaleToKw;
    let loading = Math.abs(pKw) / row.ratingKva;
    if (row.currentLimitAmps && currentMaps.length > 0 && currentMaps.every((map) => map.has(t))) {
      loading = currentLoading(
        currentMaps.map((map) => map.get(t) ?? 0),
        row.currentLimitAmps,
      );
    }
    samples.push({ t, pKw, loading });
  }
  return samples;
}

function mergeSamples(
  prior: { t: string; pKw: number; loading: number }[],
  fresh: { t: string; pKw: number; loading: number }[],
  earliest: number,
): { t: string; pKw: number; loading: number }[] {
  const map = new Map<string, { t: string; pKw: number; loading: number }>();
  for (const sample of prior) map.set(sample.t, sample);
  for (const sample of fresh) map.set(sample.t, sample);
  return [...map.values()]
    .filter((sample) => Date.parse(sample.t) >= earliest)
    .sort((a, b) => a.t.localeCompare(b.t));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ingest failed");
  process.exitCode = 1;
});
