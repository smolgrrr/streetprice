import { ratingKvaFromAmps } from "./price";
import type { CohortFeeder, RatingSource } from "./types";

/** LV feeder fuse used when NeRDA publishes no current limit and no transformer kVA. */
export const ASSUMED_FUSE_AMPS = 200;

export const COHORT_LIMIT = 12;

export const PILOT_FEEDERS = new Set([
  "VENABLES CLOSE\n4626_001_480_01",
  "VENABLES CLOSE\n4626_001_480_02",
  "VENABLES CLOSE\n4626_001_480_03",
  "VENABLES CLOSE\n4626_001_480_04",
  "VENABLES CLOSE\n4626_001_480_05",
  "JUXON ST FLATS\n4626_001_500_01",
  "JUXON ST FLATS\n4626_001_500_02",
  "JUXON ST FLATS\n4626_001_500_03",
  "ST BERNARDS ROAD\n4910_002_030_01",
  "ST BERNARDS ROAD\n4910_002_030_03",
  "ST BERNARDS ROAD\n4910_002_030_04",
  "ST BERNARDS ROAD\n4910_002_030_05",
]);

export type SeriesPoint = {
  id: string;
  scaleToKw?: number;
  phase: string;
  name: string;
};

export type DiscoveredLine = {
  substationId: string;
  substationName: string;
  lat: number;
  lon: number;
  lineName: string;
  feederName: string;
  limit: number;
  hasCurrentLimit: boolean;
  power: SeriesPoint[];
  current: SeriesPoint[];
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function feederLabel(feederName: string, lineName: string): string {
  const numbered = /^feeder\s*(\d+)$/i.exec(feederName.trim());
  if (numbered) return `Feeder ${numbered[1]}`;
  if (feederName.trim()) return titleCase(feederName.trim());
  return lineName;
}

function preferOne(points: SeriesPoint[]): SeriesPoint {
  return points.find((point) => /rms/i.test(point.name)) ?? points[0];
}

/** One series per phase. Repeated monitors of the same phase keep a single RMS reading. */
export function onePerPhase(points: SeriesPoint[]): SeriesPoint[] {
  const groups = new Map<string, SeriesPoint[]>();
  for (const point of points) {
    if (!point.id) continue;
    const key = point.phase.trim() || point.id;
    const list = groups.get(key) ?? [];
    if (!list.some((item) => item.id === point.id)) list.push(point);
    groups.set(key, list);
  }
  return [...groups.values()].map(preferOne);
}

function ratingFor(
  limit: number,
  hasCurrent: boolean,
  sharedKva: number | null,
): { ratingKva: number; ratingSource: RatingSource; currentLimitAmps: number | null } {
  if (limit > 0 && limit <= 2000 && hasCurrent) {
    return { ratingKva: ratingKvaFromAmps(limit), ratingSource: "amps", currentLimitAmps: limit };
  }
  if (limit > 2000) {
    return { ratingKva: limit / 1000, ratingSource: "kva", currentLimitAmps: null };
  }
  if (limit > 0) {
    return { ratingKva: limit, ratingSource: "kva", currentLimitAmps: null };
  }
  if (sharedKva && sharedKva > 0) {
    return {
      ratingKva: sharedKva,
      ratingSource: "assumed-transformer-share",
      currentLimitAmps: null,
    };
  }
  return {
    ratingKva: ratingKvaFromAmps(ASSUMED_FUSE_AMPS),
    ratingSource: "assumed-feeder-fuse",
    currentLimitAmps: ASSUMED_FUSE_AMPS,
  };
}

export function feedersFromLines(lines: DiscoveredLine[], sharedKva = new Map<string, number>()): CohortFeeder[] {
  const groups = new Map<string, DiscoveredLine[]>();
  for (const line of lines) {
    if (line.power.length === 0) continue;
    const key = `${line.substationId}\n${line.lineName || line.feederName}`;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  const feeders: CohortFeeder[] = [];
  const labels = new Map<string, Set<string>>();
  for (const [key, rows] of groups) {
    const first = rows[0];
    const power = onePerPhase(rows.flatMap((row) => row.power));
    const current = onePerPhase(rows.flatMap((row) => row.current));
    const scales = [...new Set(power.map((point) => point.scaleToKw ?? 0.001))];
    const scale = scales.length === 1 ? scales[0] : null;
    if (scale === null || power.length === 0) continue;
    const limit = Math.max(...rows.map((row) => row.limit));
    const rating = ratingFor(limit, current.length > 0 || rows.some((row) => row.hasCurrentLimit), sharedKva.get(first.substationId) ?? null);
    const used = labels.get(first.substationId) ?? new Set<string>();
    let name = feederLabel(first.feederName, first.lineName);
    if (used.has(name)) name = `${name} ${first.lineName}`;
    used.add(name);
    labels.set(first.substationId, used);
    feeders.push({
      id: key,
      name,
      substationId: first.substationId,
      substationName: titleCase(first.substationName),
      lat: first.lat,
      lon: first.lon,
      ratingKva: rating.ratingKva,
      ratingSource: rating.ratingSource,
      powerScaleToKw: scale,
      powerMeasurementIds: power.map((point) => point.id),
      currentMeasurementIds: current.map((point) => point.id),
      currentLimitAmps: rating.currentLimitAmps,
    });
  }
  return feeders;
}

/** The fixed, quality-checked Oxford pilot cohort, in map and UI order. */
export function selectCohort(feeders: CohortFeeder[]): CohortFeeder[] {
  const selected = feeders.filter((feeder) => PILOT_FEEDERS.has(feeder.id));
  return selected.sort(
    (a, b) =>
      a.substationName.localeCompare(b.substationName) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}
