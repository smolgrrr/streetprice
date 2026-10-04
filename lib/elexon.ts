export type WholesalePoint = { t: string; gbpPerMwh: number };

export function parseMarketIndex(payload: unknown): WholesalePoint[] {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("Elexon market index response has no data");
  }
  const data = (payload as { data: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Elexon market index data is not a list");
  }
  const points: WholesalePoint[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as { startTime?: unknown; price?: unknown };
    if (typeof record.startTime !== "string" || typeof record.price !== "number") continue;
    points.push({ t: new Date(record.startTime).toISOString(), gbpPerMwh: record.price });
  }
  points.sort((a, b) => a.t.localeCompare(b.t));
  return points;
}

/** Price in force at `t`: the latest market-index point at or before `t`. */
export function wholesaleAt(points: WholesalePoint[], t: string): number {
  if (points.length === 0) return 0;
  const instant = new Date(t).toISOString();
  let price = points[0].gbpPerMwh;
  for (const point of points) {
    if (point.t <= instant) price = point.gbpPerMwh;
    else break;
  }
  return price;
}

export async function fetchMarketIndex(from: Date, to: Date): Promise<WholesalePoint[]> {
  const url = new URL("https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index");
  url.searchParams.set("from", from.toISOString().replace(".000Z", "Z"));
  url.searchParams.set("to", to.toISOString().replace(".000Z", "Z"));
  url.searchParams.set("dataProviders", "APXMIDP");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Elexon market index returned ${response.status}`);
  }
  return parseMarketIndex(await response.json());
}
