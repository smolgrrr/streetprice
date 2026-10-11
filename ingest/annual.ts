import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { annualCapacity, annualCoverageRule, annualWindow, dailyMaxima } from "../lib/annual-capacity";
import { loadLocalEnv } from "../lib/env";
import { fetchBetween, mergeAnalogSeries, NerdaAuthError, threePhasePowerKw, type AnalogSeries, type HistoryPoint } from "../lib/nerda";
import type { AnnualCapacityModel, CohortFeeder, Snapshot } from "../lib/types";
import { worstObservedDay } from "../lib/worst-day";
import { defaultScenario, importLimit } from "../lib/constraint";
import { annualTimeProfile, capacityDuration } from "../lib/capacity-duration";

loadLocalEnv();

async function json<T>(file: string) { return JSON.parse(await readFile(file, "utf8")) as T; }

async function fetchHistory(id: string, start: Date, end: Date): Promise<AnalogSeries[]> {
  for (let attempt = 0; ; attempt++) {
    try { return await fetchBetween(id, start, end); }
    catch (error) {
      if (error instanceof NerdaAuthError || attempt >= 3) throw error;
      if (error instanceof Error && /timed out/.test(error.message) && +end - +start > 7 * 86_400_000) {
        const middle = new Date(Math.floor((+start + +end) / 2 / 1_800_000) * 1_800_000);
        return [...await fetchHistory(id, start, middle), ...await fetchHistory(id, middle, end)];
      }
      console.log(`Retrying annual history request (${attempt + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }
}

async function main() {
  const snapshot = await json<Snapshot>("data/snapshot.json");
  const discovered = await json<CohortFeeder[]>("cohort.json");
  const ids = new Set(snapshot.feeders.map(feeder => feeder.id));
  const cohort = discovered.filter(feeder => ids.has(feeder.id));
  if (cohort.length !== ids.size) throw new Error("Discovery must retain every saved feeder before annual ingestion.");
  if (snapshot.windowMode !== "previous-24h" && snapshot.windowMode !== "latest-available-24h") {
    throw new Error("Run the 24-hour ingest before deriving annual capacity.");
  }
  const { start, end } = annualWindow(new Date(snapshot.window.end));
  const model: AnnualCapacityModel = { generatedAt: new Date().toISOString(),
    window: { start: start.toISOString(), end: end.toISOString() },
    method: "mean-daily-absolute-maxima", coverageRule: annualCoverageRule, feeders: {}, substations: {} };
  const cacheDir = path.join("data", "annual-cache");
  await mkdir(cacheDir, { recursive: true });
  const priority = cohort.find(feeder => feeder.id === "SPRINGFIELD ROAD\n4626_006_170_02")?.substationId;
  const groups = [...new Set(cohort.map(feeder => feeder.substationId))].sort((a, b) => Number(b === priority) - Number(a === priority));
  let cursor = 0, done = 0;
  const publish = async () => {
    const file = path.join("data", "annual-capacity.json");
    await writeFile(`${file}.tmp`, JSON.stringify(model));
    await rename(`${file}.tmp`, file);
  };
  async function pointsFor(feeder: CohortFeeder) {
    const points: HistoryPoint[] = [];
    const prefix = `${encodeURIComponent(feeder.id)}-`;
    const ranges: Array<{ start: number; end: number }> = [];
    for (const name of (await readdir(cacheDir)).filter(name => name.startsWith(prefix))) {
      const match = name.match(/-(\d+)-(\d+)\.json$/);
      if (!match) continue;
      const from = Number(match[1]), to = Number(match[2]);
      if (from >= +end || to <= +start) continue;
      try { points.push(...await json<HistoryPoint[]>(path.join(cacheDir, name))); ranges.push({ start: from, end: to }); }
      catch { /* A broken cache page is fetched again. */ }
    }
    ranges.sort((a, b) => a.start - b.start);
    let cursor = +start;
    const missing: Array<{ start: number; end: number }> = [];
    for (const range of ranges) {
      if (range.start > cursor) missing.push({ start: cursor, end: Math.min(+end, range.start) });
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < +end) missing.push({ start: cursor, end: +end });
    // Month-sized requests are cached individually; no raw history is deployed.
    for (const gap of missing) for (let from = gap.start; from < gap.end;) {
      const to = Math.min(gap.end, from + 28 * 86_400_000);
      const file = path.join(cacheDir, `${encodeURIComponent(feeder.id)}-${from}-${to}.json`);
      let chunk: HistoryPoint[];
      try { chunk = await json<HistoryPoint[]>(file); }
      catch {
        const analogs = (await Promise.all(feeder.powerMeasurementIds.map(id =>
          fetchHistory(id, new Date(from), new Date(to))))).flat();
        chunk = threePhasePowerKw(mergeAnalogSeries(analogs), feeder.powerScaleToKw)
          .filter(point => Date.parse(point.t) >= from && Date.parse(point.t) < to);
        await writeFile(file, JSON.stringify(chunk));
      }
      points.push(...chunk);
      from = to;
    }
    return [...new Map(points.filter(point => Date.parse(point.t) >= +start && Date.parse(point.t) < +end)
      .map(point => [point.t, point])).values()];
  }
  async function worker() {
    while (cursor < groups.length) {
      const id = groups[cursor++];
      const members = cohort.filter(feeder => feeder.substationId === id);
      const observations = new Map<string, HistoryPoint[]>();
      for (const feeder of members) {
        const points = await pointsFor(feeder);
        observations.set(feeder.id, points);
        model.feeders[feeder.id] = annualCapacity(dailyMaxima(points, start, end), start, end);
        model.feeders[feeder.id].duration = capacityDuration(points, start, end, model.feeders[feeder.id].assetKw);
        model.feeders[feeder.id].timeProfile = annualTimeProfile(points, start, end);
        model.feeders[feeder.id].worstDay = worstObservedDay(points, start, end,
          importLimit(feeder, { ...defaultScenario, importAmps: snapshot.ratingAssumptionAmps }), defaultScenario.exportKw!);
        console.log(`${++done}/${cohort.length} ${feeder.substationName} ${feeder.name}: ${model.feeders[feeder.id].coveredDays} covered days`);
      }
      // Sum simultaneous signed readings BEFORE taking daily maxima. Summing
      // individual feeder maxima would invent a non-coincident transformer peak.
      const byTime = members.map(feeder => new Map(observations.get(feeder.id)!.map(point => [point.t, point.value])));
      const sums = [...byTime[0]].flatMap(([t]) => byTime.every(series => series.has(t))
        ? [{ t, value: byTime.reduce((sum, series) => sum + series.get(t)!, 0) }] : []);
      model.substations[id] = annualCapacity(dailyMaxima(sums, start, end), start, end);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  await publish();
  console.log(`Annual model ready: ${Object.values(model.feeders).filter(item => item.status === "ready").length}/${cohort.length} feeders have sufficient history.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Annual ingest failed"); process.exitCode = 1; });
