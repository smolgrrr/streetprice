import { request as httpsRequest } from "node:https";

const NERDA_ORIGIN = "https://nerda-prod-apis-v2.azurewebsites.net/api/";

export type HistoryPoint = { t: string; value: number };

export type AnalogSeries = {
  aliasName: string;
  name: string;
  unit: string;
  points: HistoryPoint[];
};

export class NerdaAuthError extends Error {
  constructor(status: number) {
    super(`NeRDA rejected the API key (${status})`);
    this.name = "NerdaAuthError";
  }
}

export async function nerdaGet(pathname: string, params: Record<string, string> = {}): Promise<unknown> {
  const username = process.env.NERDA_USERNAME;
  const apiKey = process.env.NERDA_API_KEY;
  if (!username || !apiKey) {
    throw new Error("Set NERDA_USERNAME and NERDA_API_KEY");
  }
  const url = new URL(pathname.replace(/^\//, ""), NERDA_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const body = JSON.stringify({ username, apiKey });
  // NeRDA's long-term key is a JSON body on GET. fetch() refuses that combination.
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString("utf8");
          if (status === 401 || status === 403) {
            reject(new NerdaAuthError(status));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new Error(`NeRDA ${status} on ${pathname}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as unknown);
          } catch {
            reject(new Error(`NeRDA returned non-JSON on ${pathname}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export function parseAnalogSeries(payload: unknown): AnalogSeries[] {
  const found: AnalogSeries[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.value_history)) {
      const points = new Map<string, number>();
      for (const row of record.value_history) {
        if (!row || typeof row !== "object") continue;
        const item = row as { __ts?: unknown; _ts?: unknown; value?: unknown };
        const timestamp = item.__ts ?? item._ts;
        if (typeof timestamp !== "string" || typeof item.value !== "number") continue;
        const instant = new Date(timestamp);
        if (Number.isNaN(instant.getTime()) || !Number.isFinite(item.value)) continue;
        points.set(instant.toISOString(), item.value);
      }
      found.push({
        aliasName: typeof record.aliasName === "string" ? record.aliasName : "",
        name:
          typeof record.name === "string"
            ? record.name
            : typeof record.measurementName === "string"
              ? record.measurementName
              : "",
        unit:
          typeof record.unitSymbol === "string"
            ? record.unitSymbol
            : typeof record.unit === "string"
              ? record.unit
              : "",
        points: [...points].map(([t, value]) => ({ t, value })).sort((a, b) => a.t.localeCompare(b.t)),
      });
    }
    for (const value of Object.values(record)) {
      if (value !== record.value_history) visit(value);
    }
  };
  visit(payload);
  return found;
}

/** Merge paged responses by analog identity and de-duplicate readings by timestamp. */
export function mergeAnalogSeries(series: AnalogSeries[]): AnalogSeries[] {
  const groups = new Map<string, AnalogSeries & { values: Map<string, number> }>();
  for (const analog of series) {
    const key = `${analog.aliasName}\n${analog.name}\n${analog.unit}`;
    const group = groups.get(key) ?? { ...analog, points: [], values: new Map<string, number>() };
    for (const point of analog.points) group.values.set(point.t, point.value);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ values, ...analog }) => ({
    ...analog,
    points: [...values].map(([t, value]) => ({ t, value })).sort((a, b) => a.t.localeCompare(b.t)),
  }));
}

/** Prefer the RMS analog when min, max, and RMS are all present. */
export function parseValueHistory(payload: unknown): HistoryPoint[] {
  const analogs = parseAnalogSeries(payload).filter((analog) => analog.points.length > 0);
  const chosen =
    analogs.find((analog) => /rms/i.test(`${analog.aliasName} ${analog.name}`)) ?? analogs[0];
  if (!chosen) return [];
  return [...chosen.points].sort((a, b) => a.t.localeCompare(b.t));
}

function phaseOf(series: AnalogSeries): 1 | 2 | 3 | null {
  const label = `${series.aliasName} ${series.name}`;
  const match = label.match(/\.p([123])(?:\b|$)/i) ?? label.match(/(?:phase|ph|l)[ ._-]?([123])\b/i);
  if (!match) return null;
  return Number(match[1]) as 1 | 2 | 3;
}

/**
 * Average readings into half-hour phase buckets, then sum p1+p2+p3.
 * A bucket is omitted when any phase is absent; no interpolation is applied.
 */
export function threePhasePowerKw(
  series: AnalogSeries[],
  scaleToKw: number,
  bucketMinutes = 30,
): HistoryPoint[] {
  const bucketMs = bucketMinutes * 60 * 1000;
  const phases = new Map<number, Map<number, Map<string, number>>>([
    [1, new Map()],
    [2, new Map()],
    [3, new Map()],
  ]);
  for (const analog of series) {
    const phase = phaseOf(analog);
    if (!phase) continue;
    const phaseBuckets = phases.get(phase)!;
    for (const point of analog.points) {
      const instant = Date.parse(point.t);
      if (!Number.isFinite(instant)) continue;
      const bucket = Math.floor(instant / bucketMs) * bucketMs;
      const readings = phaseBuckets.get(bucket) ?? new Map<string, number>();
      readings.set(point.t, point.value);
      phaseBuckets.set(bucket, readings);
    }
  }

  const buckets = new Set<number>();
  for (const phaseBuckets of phases.values()) {
    for (const bucket of phaseBuckets.keys()) buckets.add(bucket);
  }
  const result: HistoryPoint[] = [];
  for (const bucket of [...buckets].sort((a, b) => a - b)) {
    const phaseAverages: number[] = [];
    for (const phase of [1, 2, 3]) {
      const readings = phases.get(phase)?.get(bucket);
      if (!readings || readings.size === 0) break;
      const values = [...readings.values()];
      phaseAverages.push(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    if (phaseAverages.length !== 3) continue;
    result.push({
      t: new Date(bucket).toISOString(),
      value: phaseAverages.reduce((sum, value) => sum + value, 0) * scaleToKw,
    });
  }
  return result;
}

export async function fetchStatic(substationId?: string): Promise<unknown> {
  if (!substationId) return nerdaGet("ApiNerdaStatic");
  return nerdaGet("ApiNerdaStatic", { substation: substationId });
}

export async function fetchBetween(
  measurementId: string,
  after: Date,
  before: Date,
): Promise<AnalogSeries[]> {
  const payload = await nerdaGet("ApiNerdaBetween", {
    measurement: measurementId,
    after: after.toISOString(),
    before: before.toISOString(),
  });
  return parseAnalogSeries(payload);
}
