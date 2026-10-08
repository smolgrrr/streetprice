import { VectorTile } from "@mapbox/vector-tile";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PbfReader } from "pbf";

// Same Oxford box as lib/cohort.ts LOCAL_AREA. OpenFreeMap is also the map's
// basemap, so this avoids a separate, fragile city-sized Overpass query.
const BOX = { minLat: 51.7, maxLat: 51.82, minLon: -1.32, maxLon: -1.15 };
const ZOOM = 14;
const KEEP = new Set(["minor", "service", "primary", "secondary", "tertiary", "trunk"]);

function tileX(lon) {
  return Math.floor(((lon + 180) / 360) * 2 ** ZOOM);
}

function tileY(lat) {
  const radians = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** ZOOM);
}

function tiles() {
  const result = [];
  const minX = tileX(BOX.minLon);
  const maxX = tileX(BOX.maxLon);
  const minY = tileY(BOX.maxLat);
  const maxY = tileY(BOX.minLat);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) result.push({ x, y });
  }
  return result;
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function lineStrings(geometry) {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

async function mapPool(items, limit, task) {
  const results = Array.from({ length: items.length });
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchTile(template, tile, index, total) {
  const url = template
    .replace("{z}", String(ZOOM))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`tile ${tile.x}/${tile.y} returned ${response.status}`);
  const vector = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
  const layer = vector.layers.transportation;
  const ways = [];
  if (layer) {
    for (let featureIndex = 0; featureIndex < layer.length; featureIndex++) {
      const feature = layer.feature(featureIndex);
      if (!KEEP.has(String(feature.properties.class ?? ""))) continue;
      const geojson = feature.toGeoJSON(tile.x, tile.y, ZOOM);
      for (const line of lineStrings(geojson.geometry)) {
        const coords = line.map(([lon, lat]) => [round(lon), round(lat)]);
        if (coords.length >= 2) ways.push({ coords });
      }
    }
  }
  console.error(`tile ${index + 1}/${total} ${ways.length} roads`);
  return ways;
}

const tileJsonResponse = await fetch("https://tiles.openfreemap.org/planet", {
  signal: AbortSignal.timeout(15_000),
});
if (!tileJsonResponse.ok) throw new Error(`OpenFreeMap returned ${tileJsonResponse.status}`);
const tileJson = await tileJsonResponse.json();
const template = tileJson.tiles?.[0];
if (typeof template !== "string") throw new Error("OpenFreeMap did not publish a tile URL");

const selectedTiles = tiles();
const batches = await mapPool(selectedTiles, 8, (tile, index) =>
  fetchTile(template, tile, index, selectedTiles.length),
);
const seen = new Set();
const ways = batches.flat().filter((way) => {
  const key = way.coords.map((coord) => coord.join(",")).join(";");
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
if (ways.length < 100) throw new Error(`Only ${ways.length} street segments came back`);

const directory = path.join(process.cwd(), "data");
await mkdir(directory, { recursive: true });
const file = path.join(directory, "street-network.json");
const body = JSON.stringify({ attribution: "© OpenStreetMap contributors", ways });
await writeFile(file, body);
console.log(`DONE: ${ways.length} street segments, ${body.length} bytes, ${file}`);
