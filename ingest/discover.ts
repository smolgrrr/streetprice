import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLocalEnv } from "../lib/env";
import { fetchStatic } from "../lib/nerda";
import { ratingKvaFromAmps } from "../lib/price";
import type { CohortFeeder, RatingSource } from "../lib/types";

const BOX = { minLat: 51.7, maxLat: 51.82, minLon: -1.32, maxLon: -1.15 };

loadLocalEnv();

type Measurement = {
  id: string;
  type: string;
  unit: string;
  multiplier: string;
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

function inBox(lat: number, lon: number): boolean {
  return lat >= BOX.minLat && lat <= BOX.maxLat && lon >= BOX.minLon && lon <= BOX.maxLon;
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

function ratingFor(
  limit: number,
  hasCurrent: boolean,
  sharedKva: number | null,
): { ratingKva: number; ratingSource: RatingSource } | null {
  if (limit > 0 && limit <= 2000 && hasCurrent) {
    return { ratingKva: ratingKvaFromAmps(limit), ratingSource: "amps" };
  }
  if (limit > 2000) {
    return { ratingKva: limit / 1000, ratingSource: "kva" };
  }
  if (limit > 0) {
    return { ratingKva: limit, ratingSource: "kva" };
  }
  if (sharedKva && sharedKva > 0) {
    return { ratingKva: sharedKva, ratingSource: "assumed-transformer-share" };
  }
  return null;
}

async function main(): Promise<void> {
  const only = process.env.NERDA_SUBSTATION_ID;
  const payload = await fetchStatic(only);
  const sites = sitesFrom(payload);
  const feeders: CohortFeeder[] = [];
  let inArea = 0;

  for (const [index, site] of sites.entries()) {
    const point = coords(site);
    if (!point || !inBox(point.lat, point.lon)) continue;
    inArea += 1;
    const lines = asArray(site.lines).flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
    const shared = transformerKva(site);
    const share = shared && lines.length > 0 ? shared / lines.length : null;
    const name = siteName(site, index);
    const id = siteId(site, index);

    for (const line of lines) {
      const measurements = measurementsOf(line);
      const power = measurements.filter(isRealPower);
      const current = measurements.filter(isLineCurrent);
      if (power.length === 0) continue;
      const limit = numberish(line.limit) ?? 0;
      const rating = ratingFor(limit, current.length > 0, share);
      if (!rating) continue;
      const linePoint = coords(line) ?? point;
      const lineName = text(line.line_name) || text(line.name) || text(line.nerda_line_uuid);
      feeders.push({
        id: text(line.nerda_line_uuid) || `${id}:${lineName}`,
        name: lineName,
        substationId: id,
        substationName: name,
        lat: linePoint.lat,
        lon: linePoint.lon,
        ratingKva: rating.ratingKva,
        ratingSource: rating.ratingSource,
        powerScaleToKw: powerScale(power[0]),
        powerMeasurementIds: power.map((measurement) => measurement.id),
        currentMeasurementIds: current.map((measurement) => measurement.id),
        currentLimitAmps: rating.ratingSource === "amps" ? limit : null,
      });
    }
  }

  const directory = path.join(process.cwd(), "data");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "candidates.json");
  await writeFile(file, JSON.stringify(feeders, null, 2));
  console.log(
    `${sites.length} substations in the static feed, ${inArea} inside the Oxford box, ${feeders.length} feeders with signed power and a rating.`,
  );
  console.log(`Wrote ${file}. Review it, then copy the keepers to cohort.json (200 feeders maximum).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Discovery failed";
  console.error(message);
  process.exitCode = 1;
});
