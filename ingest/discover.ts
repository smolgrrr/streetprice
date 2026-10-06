import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { feedersFromLines, inLocalArea, selectCohort, type DiscoveredLine } from "../lib/cohort";
import { loadLocalEnv } from "../lib/env";
import { fetchStatic } from "../lib/nerda";

loadLocalEnv();

type Measurement = {
  id: string;
  type: string;
  unit: string;
  multiplier: string;
  phase: string;
  name: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sitesFrom(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
  }
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["substations", "data", "items", "value"]) {
    if (Array.isArray(record[key])) return sitesFrom(record[key]);
  }
  return [record];
}

function coords(record: Record<string, unknown>): { lat: number; lon: number } | null {
  const lat = numberish(record.latitude ?? record.lat);
  const lon = numberish(record.longitude ?? record.lon ?? record.lng);
  if (lat === null || lon === null) return null;
  return { lat, lon };
}



function measurementsOf(line: Record<string, unknown>): Measurement[] {
  return asArray(line.measurements).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const id = text(record.nerda_measurement_id ?? record.measurementId);
    if (!id) return [];
    return [
      {
        id,
        type: text(record.measurementType ?? record.type),
        unit: text(record.unitSymbol ?? record.unit),
        multiplier: text(record.unitMultiplier ?? record.multiplier) || "none",
        phase: text(record.phase ?? record.phases ?? record.terminal ?? record.measurementPhase),
        name: text(record.aliasName ?? record.measurementName ?? record.name),
      },
    ];
  });
}

function isRealPower(measurement: Measurement): boolean {
  const type = measurement.type.toLowerCase();
  const unit = measurement.unit.toLowerCase();
  if (type.includes("reactive") || unit.includes("var")) return false;
  if (unit === "wh" || unit === "kwh" || type.includes("energy")) return false;
  return unit === "w" || unit === "kw" || type.includes("real") || type.includes("activepower");
}

function isLineCurrent(measurement: Measurement): boolean {
  const type = measurement.type.toLowerCase();
  if (type.includes("thd") || type.includes("angle") || type.includes("frequency")) return false;
  return measurement.unit.toUpperCase() === "A" || type === "linecurrent";
}

function powerScale(measurement: Measurement): number {
  const unit = measurement.unit.toLowerCase();
  const multiplier = measurement.multiplier.toLowerCase();
  if (unit === "kw" || multiplier === "kilo" || multiplier === "k") return 1;
  if (multiplier === "mega" || multiplier === "m") return 1000;
  return 0.001;
}

function transformerKva(site: Record<string, unknown>): number | null {
  let total = 0;
  let found = false;
  for (const item of asArray(site.transformers)) {
    const record = asRecord(item);
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      if (!/kva|rating|rated|limit|capacity/i.test(key)) continue;
      const amount = numberish(value);
      if (amount && amount > 0) {
        total += amount;
        found = true;
        break;
      }
    }
  }
  return found ? total : null;
}

function siteName(site: Record<string, unknown>, index: number): string {
  return (
    text(site.name) ||
    text(site.substation_name) ||
    text(site.sds_site_id) ||
    text(site.site_name) ||
    `Substation ${index + 1}`
  );
}

function siteId(site: Record<string, unknown>, index: number): string {
  return (
    text(site.id) ||
    text(site.nerda_site_uuid) ||
    text(site.substation_id) ||
    siteName(site, index)
  );
}

async function main(): Promise<void> {
  const only = process.env.NERDA_SUBSTATION_ID;
  const payload = await fetchStatic(only);
  const sites = sitesFrom(payload);
  const discovered: DiscoveredLine[] = [];
  const sharedKva = new Map<string, number>();
  let inArea = 0;
  const measurementKeys = new Set<string>();

  for (const [index, site] of sites.entries()) {
    const point = coords(site);
    if (!point || !inLocalArea(point.lat, point.lon)) continue;
    inArea += 1;
    const lines = asArray(site.lines).flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
    const name = siteName(site, index);
    const id = siteId(site, index);
    const transformer = transformerKva(site);
    if (transformer) sharedKva.set(id, transformer / Math.max(1, lines.length));

    for (const line of lines) {
      if (measurementKeys.size < 12) {
        const first = asArray(line.measurements)[0];
        const record = asRecord(first);
        if (record) for (const key of Object.keys(record)) measurementKeys.add(key);
      }
      const measurements = measurementsOf(line);
      const power = measurements.filter(isRealPower);
      if (power.length === 0) continue;
      const current = measurements.filter(isLineCurrent);
      const linePoint = coords(line) ?? point;
      discovered.push({
        substationId: id,
        substationName: name,
        lat: linePoint.lat,
        lon: linePoint.lon,
        lineName: text(line.line_name) || text(line.name) || text(line.nerda_line_uuid),
        feederName: text(line.feeder_name),
        limit: numberish(line.limit) ?? 0,
        hasCurrentLimit: current.length > 0,
        power: power.map((measurement) => ({
          id: measurement.id,
          scaleToKw: powerScale(measurement),
          phase: measurement.phase,
          name: measurement.name,
        })),
        current: current.map((measurement) => ({
          id: measurement.id,
          phase: measurement.phase,
          name: measurement.name,
        })),
      });
    }
  }

  const feeders = feedersFromLines(discovered, sharedKva);
  const cohort = selectCohort(feeders);
  const directory = path.join(process.cwd(), "data");
  await mkdir(directory, { recursive: true });
  const candidates = path.join(directory, "candidates.json");
  const cohortFile = path.join(process.cwd(), "cohort.json");
  await writeFile(candidates, JSON.stringify(feeders, null, 2));
  await writeFile(cohortFile, JSON.stringify(cohort, null, 2));
  const phases = feeders.map((feeder) => feeder.powerMeasurementIds.length);
  phases.sort((a, b) => a - b);
  const median = phases[Math.floor(phases.length / 2)] ?? 0;
  const sitesInCohort = new Set(cohort.map((feeder) => feeder.substationId)).size;
  console.log(
    `${sites.length} substations in the static feed, ${inArea} inside the Oxford box, ${feeders.length} feeders after grouping.`,
  );
  console.log(
    `Power series per feeder: min ${phases[0] ?? 0}, median ${median}, max ${phases[phases.length - 1] ?? 0}.`,
  );
  console.log(`Measurement fields: ${[...measurementKeys].sort().join(", ") || "none"}.`);
  console.log(`Cohort keeps ${cohort.length} feeders on ${sitesInCohort} substations.`);
  console.log(`Wrote ${candidates} and ${cohortFile}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Discovery failed";
  console.error(message);
  process.exitCode = 1;
});
