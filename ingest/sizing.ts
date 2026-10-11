import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnnualCapacityModel, Snapshot } from "../lib/types";
import type { HistoryPoint } from "../lib/nerda";
import { sizingCurve, type FeederSizingCurve } from "../lib/sizing-equilibrium";

async function main() {
const snapshot = JSON.parse(await readFile("data/snapshot.json", "utf8")) as Snapshot;
const annual = JSON.parse(await readFile("data/annual-capacity.json", "utf8")) as AnnualCapacityModel;
const start = Date.parse(annual.window.start), end = Date.parse(annual.window.end);
const expectedBuckets = (end - start) / 1800000;
const cacheDir = path.join("data", "annual-cache");
const names = await readdir(cacheDir);
const feeders: Record<string, FeederSizingCurve> = {};
for (const feeder of snapshot.feeders) {
  if (annual.feeders[feeder.id]?.status !== "ready") continue;
  const prefix = `${encodeURIComponent(feeder.id)}-`;
  const readings = new Map<string, number>();
  for (const name of names.filter(name => name.startsWith(prefix))) {
    const match = name.match(/-(\d+)-(\d+)\.json$/);
    if (!match || Number(match[1]) >= end || Number(match[2]) <= start) continue;
    try {
      for (const point of JSON.parse(await readFile(path.join(cacheDir, name), "utf8")) as HistoryPoint[]) {
        const t = Date.parse(point.t);
        if (t >= start && t < end && Number.isFinite(point.value)) readings.set(point.t, point.value);
      }
    } catch { /* Incomplete cache pages remain missing readings. */ }
  }
  const loads = [...readings].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  if (!loads.length) continue;
  feeders[feeder.id] = sizingCurve(loads, expectedBuckets, snapshot.parameters);
  console.log(`${Object.keys(feeders).length} ${feeder.substationName} / ${feeder.name}: ${loads.length}/${expectedBuckets} readings`);
}
const output = { generatedAt: new Date().toISOString(), window: annual.window, feeders };
await writeFile("data/sizing-curves.json.tmp", JSON.stringify(output));
await rename("data/sizing-curves.json.tmp", "data/sizing-curves.json");
console.log(`Sizing curves ready for ${Object.keys(feeders).length} feeders.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
