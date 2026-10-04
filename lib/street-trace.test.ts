import { describe, expect, it } from "vitest";
import { streetLayout } from "./street-trace";

const SITES = [
  { id: "JUXON ST FLATS", name: "Juxon", lat: 51.759821, lon: -1.269897, feeders: [1, 2, 3] },
  { id: "ST BERNARDS ROAD", name: "St Bernards", lat: 51.762019, lon: -1.265716, feeders: [1, 3, 4, 5] },
  { id: "VENABLES CLOSE", name: "Venables", lat: 51.760522, lon: -1.267604, feeders: [1, 2, 3, 4, 5] },
];

const feeders = SITES.flatMap((site) =>
  site.feeders.map((number) => ({
    id: `${site.id}\nfeeder-${number}`,
    substationId: site.id,
    lat: site.lat,
    lon: site.lon,
  })),
);

function lengthMetres(coordinates: [number, number][][]): number {
  let total = 0;
  for (const line of coordinates) {
    for (let index = 1; index < line.length; index++) {
      const dx = (line[index][0] - line[index - 1][0]) * 64000;
      const dy = (line[index][1] - line[index - 1][1]) * 111000;
      total += Math.hypot(dx, dy);
    }
  }
  return total;
}

describe("street traces", () => {
  const layout = streetLayout(feeders);

  it("gives every pilot feeder its own street lines", () => {
    expect(layout.traces).toHaveLength(12);
    for (const trace of layout.traces) {
      expect(trace.coordinates.length).toBeGreaterThan(0);
      expect(lengthMetres(trace.coordinates)).toBeGreaterThan(80);
    }
    const ids = layout.traces.map((trace) => trace.feederId);
    expect(new Set(ids).size).toBe(12);
  });

  it("keeps each substation's lines apart from the other two", () => {
    for (const site of SITES) {
      const mine = layout.traces.filter((trace) => trace.substationId === site.id);
      expect(mine).toHaveLength(site.feeders.length);
      const signatures = mine.map((trace) => JSON.stringify(trace.coordinates));
      expect(new Set(signatures).size).toBe(site.feeders.length);
    }
  });

  it("stays inside the Oxford neighbourhood", () => {
    for (const trace of layout.traces) {
      for (const line of trace.coordinates) {
        for (const [lon, lat] of line) {
          expect(lat).toBeGreaterThan(51.755);
          expect(lat).toBeLessThan(51.767);
          expect(lon).toBeGreaterThan(-1.278);
          expect(lon).toBeLessThan(-1.256);
        }
      }
    }
  });
});
