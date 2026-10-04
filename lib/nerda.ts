const NERDA_ORIGIN = "https://nerda-prod-apis-v2.azurewebsites.net/api/";

export type HistoryPoint = { t: string; value: number };

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
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ username, apiKey }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new NerdaAuthError(response.status);
  }
  if (!response.ok) {
    throw new Error(`NeRDA ${response.status} on ${pathname}`);
  }
  return response.json();
}

type Analog = { name: string; points: HistoryPoint[] };

function collectAnalogs(payload: unknown): Analog[] {
  const found: Analog[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.value_history)) {
      const points: HistoryPoint[] = [];
      for (const row of record.value_history) {
        if (!row || typeof row !== "object") continue;
        const item = row as { _ts?: unknown; value?: unknown };
        if (typeof item._ts !== "string" || typeof item.value !== "number") continue;
        points.push({ t: new Date(item._ts).toISOString(), value: item.value });
      }
      const name = typeof record.aliasName === "string" ? record.aliasName : "";
      found.push({ name, points });
    }
    for (const value of Object.values(record)) {
      if (value !== record.value_history) visit(value);
    }
  };
  visit(payload);
  return found;
}

/** Prefer the RMS analog when min, max, and RMS are all present. */
export function parseValueHistory(payload: unknown): HistoryPoint[] {
  const analogs = collectAnalogs(payload).filter((analog) => analog.points.length > 0);
  const chosen = analogs.find((analog) => /rms/i.test(analog.name)) ?? analogs[0];
  if (!chosen) return [];
  return [...chosen.points].sort((a, b) => a.t.localeCompare(b.t));
}

export async function fetchStatic(substationId?: string): Promise<unknown> {
  if (!substationId) return nerdaGet("ApiNerdaStatic");
  return nerdaGet("ApiNerdaStatic", { substation: substationId });
}

export async function fetchBetween(
  measurementId: string,
  after: Date,
  before: Date,
): Promise<HistoryPoint[]> {
  const payload = await nerdaGet("ApiNerdaBetween", {
    measurement: measurementId,
    after: after.toISOString(),
    before: before.toISOString(),
  });
  return parseValueHistory(payload);
}
