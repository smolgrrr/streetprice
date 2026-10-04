import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareFeeders, qualityFor } from "../lib/comparison";
import { ASSUMED_FUSE_AMPS, COHORT_LIMIT } from "../lib/cohort";
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

async function main(): Promise<void> {
  const cohortFile = path.join(process.cwd(), "cohort.json");
  const cohort = await readJson<CohortFeeder[]>(cohortFile);
  if (!cohort || cohort.length !== COHORT_LIMIT) {
    throw new Error(`Expected the fixed ${COHORT_LIMIT}-feeder cohort in cohort.json. Run npm run discover.`);
  }

  const start = new Date(process.env.NERDA_WINDOW_START ?? DEFAULT_WINDOW_START);
  if (Number.isNaN(start.getTime())) throw new Error("NERDA_WINDOW_START is not a valid timestamp");
  const end = new Date(start.getTime() + 24 * HOUR);
  const expectedBuckets = Math.round((end.getTime() - start.getTime()) / HALF_HOUR);
  const wholesale = await fetchMarketIndex(start, end);
  if (wholesale.length === 0) throw new Error("Elexon returned no wholesale prices for the pilot window");

  const cap = capGbpPerMwh();
  const feeders: Feeder[] = [];
  try {
    for (const [index, row] of cohort.entries()) {
      console.log(`${index + 1}/${cohort.length} ${row.substationName} ${row.name}`);
      const analogs = (
        await Promise.all(row.powerMeasurementIds.map((id) => paged(id, start, end)))
      ).flat();
      const points = threePhasePowerKw(mergeAnalogSeries(analogs), row.powerScaleToKw).filter(
        (point) => point.t >= start.toISOString() && point.t < end.toISOString(),
      );
      const quality = qualityFor(points.length, expectedBuckets);
      feeders.push({
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
          row.ratingKva,
          cap,
        ),
      });
    }
  } catch (error) {
    if (error instanceof NerdaAuthError) {
      throw new Error(`${error.message}. The previous local snapshot was left in place.`);
    }
    throw error;
  }

  const insufficient = feeders.filter((feeder) => feeder.quality.status === "insufficient");
  if (insufficient.length > 0) {
    throw new Error(
      `Pilot quality gate failed: ${insufficient.map((feeder) => `${feeder.substationName} ${feeder.name}`).join(", ")}`,
    );
  }
  const dataThrough = feeders
    .flatMap((feeder) => feeder.samples.map((sample) => sample.t))
    .sort()
    .at(-1);
  if (!dataThrough) throw new Error("The pilot produced no complete three-phase buckets");

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
  };
  const snapshotFile = path.join(process.cwd(), "data", "snapshot.json");
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${feeders.length} historical feeders to ${snapshotFile}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ingest failed");
  process.exitCode = 1;
});
