import network from "./street-network.json";

export type TraceInput = {
  id: string;
  substationId: string;
  lat: number;
  lon: number;
};

export type StreetTrace = {
  feederId: string;
  substationId: string;
  coordinates: [number, number][][];
};

export type StreetStub = {
  substationId: string;
  coordinates: [[number, number], [number, number]];
};

type Coord = [number, number];

type GraphEdge = {
  to: string;
  coords: Coord[];
  meters: number;
};

type GraphNode = {
  lon: number;
  lat: number;
  out: GraphEdge[];
};

const MAX_REACH_M = 280;
const SNAP_TO_NODE_M = 12;
const MAX_SNAP_M = 80;

const LAT0 = (51.76 * Math.PI) / 180;
const METRES_PER_DEG_LAT = 6371000 * (Math.PI / 180);
const METRES_PER_DEG_LON = METRES_PER_DEG_LAT * Math.cos(LAT0);

function keyOf(lon: number, lat: number): string {
  return `${lon.toFixed(6)},${lat.toFixed(6)}`;
}

function metresBetween(a: Coord, b: Coord): number {
  const dx = (b[0] - a[0]) * METRES_PER_DEG_LON;
  const dy = (b[1] - a[1]) * METRES_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

type StreetWay = { coords: number[][] };

function buildGraph(ways: StreetWay[]): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  const ensure = (lon: number, lat: number) => {
    const id = keyOf(lon, lat);
    let node = nodes.get(id);
    if (!node) {
      node = { lon, lat, out: [] };
      nodes.set(id, node);
    }
    return id;
  };
  const link = (from: string, to: string, coords: Coord[]) => {
    const node = nodes.get(from);
    if (!node || from === to) return;
    const meters = coords.slice(1).reduce((sum, coord, index) => sum + metresBetween(coords[index], coord), 0);
    if (!(meters > 0)) return;
    const existing = node.out.find((edge) => edge.to === to);
    if (existing && existing.meters <= meters) return;
    node.out = node.out.filter((edge) => edge.to !== to);
    node.out.push({ to, coords, meters });
  };

  for (const way of ways) {
    let previous = ensure(way.coords[0][0], way.coords[0][1]);
    for (let index = 1; index < way.coords.length; index++) {
      const next = ensure(way.coords[index][0], way.coords[index][1]);
      const forward = way.coords.slice(index - 1, index + 1) as Coord[];
      link(previous, next, forward);
      link(next, previous, [...forward].reverse() as Coord[]);
      previous = next;
    }
  }
  return nodes;
}

function nearestNode(nodes: Map<string, GraphNode>, lon: number, lat: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const [id, node] of nodes) {
    const distance = metresBetween([lon, lat], [node.lon, node.lat]);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return bestDistance <= SNAP_TO_NODE_M ? best : null;
}

function project(nodes: Map<string, GraphNode>, lon: number, lat: number): { nodeId: string } | null {
  const existing = nearestNode(nodes, lon, lat);
  if (existing) return { nodeId: existing };

  let best: { from: string; to: string; lon: number; lat: number; distance: number } | null = null;
  const seen = new Set<string>();
  for (const [from, node] of nodes) {
    for (const edge of node.out) {
      const pair = from < edge.to ? `${from}|${edge.to}` : `${edge.to}|${from}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const ax = node.lon * METRES_PER_DEG_LON;
      const ay = node.lat * METRES_PER_DEG_LAT;
      const other = nodes.get(edge.to);
      if (!other) continue;
      const bx = other.lon * METRES_PER_DEG_LON;
      const by = other.lat * METRES_PER_DEG_LAT;
      const px = lon * METRES_PER_DEG_LON;
      const py = lat * METRES_PER_DEG_LAT;
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      if (!(length2 > 0)) continue;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
      const x = ax + dx * t;
      const y = ay + dy * t;
      const distance = Math.hypot(px - x, py - y);
      if (!best || distance < best.distance) {
        best = {
          from,
          to: edge.to,
          lon: x / METRES_PER_DEG_LON,
          lat: y / METRES_PER_DEG_LAT,
          distance,
        };
      }
    }
  }
  if (!best || best.distance > MAX_SNAP_M) return null;

  const end = nearestNode(nodes, best.lon, best.lat);
  if (end) return { nodeId: end };

  const id = keyOf(best.lon, best.lat);
  const start = nodes.get(best.from);
  const finish = nodes.get(best.to);
  if (!start || !finish) throw new Error("Snap endpoints are missing.");
  const drop = (from: string, to: string) => {
    const node = nodes.get(from);
    if (!node) return;
    node.out = node.out.filter((edge) => edge.to !== to);
  };
  drop(best.from, best.to);
  drop(best.to, best.from);
  nodes.set(id, { lon: best.lon, lat: best.lat, out: [] });
  const link = (from: string, to: string) => {
    const a = nodes.get(from);
    const b = nodes.get(to);
    if (!a || !b) return;
    a.out.push({
      to,
      coords: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
      meters: metresBetween([a.lon, a.lat], [b.lon, b.lat]),
    });
  };
  link(best.from, id);
  link(id, best.from);
  link(best.to, id);
  link(id, best.to);
  return { nodeId: id };
}

function distances(nodes: Map<string, GraphNode>, start: string): Map<string, number> {
  const dist = new Map<string, number>([[start, 0]]);
  const heap: { id: string; d: number }[] = [{ id: start, d: 0 }];
  while (heap.length > 0) {
    heap.sort((a, b) => a.d - b.d);
    const current = heap.shift();
    if (!current || current.d !== dist.get(current.id)) continue;
    for (const edge of nodes.get(current.id)?.out ?? []) {
      const next = current.d + edge.meters;
      if (next > MAX_REACH_M) continue;
      if (next + 0.01 < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        heap.push({ id: edge.to, d: next });
      }
    }
  }
  return dist;
}

function pathLength(coords: Coord[]): number {
  let total = 0;
  for (let index = 1; index < coords.length; index++) total += metresBetween(coords[index - 1], coords[index]);
  return total;
}

function bearingOf(from: Coord, to: Coord): number {
  return Math.atan2((to[0] - from[0]) * METRES_PER_DEG_LON, (to[1] - from[1]) * METRES_PER_DEG_LAT);
}

function angularGap(a: number, b: number): number {
  const turn = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(turn, Math.PI * 2 - turn);
}

/** Shift a street trace sideways, starting on the centreline so it still leaves the substation. */
function offsetPath(coords: Coord[], meters: number): Coord[] {
  if (coords.length < 2 || meters === 0) return coords;
  let travelled = 0;
  return coords.map((coord, index) => {
    const before = coords[Math.max(0, index - 1)];
    const after = coords[Math.min(coords.length - 1, index + 1)];
    if (index > 0) travelled += metresBetween(coords[index - 1], coord);
    const dx = (after[0] - before[0]) * METRES_PER_DEG_LON;
    const dy = (after[1] - before[1]) * METRES_PER_DEG_LAT;
    const span = Math.hypot(dx, dy) || 1;
    const shift = meters * Math.min(1, travelled / 40);
    return [
      coord[0] + ((-dy / span) * shift) / METRES_PER_DEG_LON,
      coord[1] + ((dx / span) * shift) / METRES_PER_DEG_LAT,
    ] as Coord;
  });
}

function pickPaths(paths: Coord[][], count: number): Coord[][] {
  if (paths.length === 0 || count === 0) return [];
  const ranked = paths
    .map((coords) => ({
      coords,
      length: pathLength(coords),
      bearing: bearingOf(coords[0], coords[Math.min(4, coords.length - 1)]),
    }))
    .filter((item) => item.length > 0)
    .sort((a, b) => b.length - a.length);
  if (ranked.length === 0) return [];
  const long = ranked.filter((item) => item.length >= 100);
  const usable = long.length >= Math.min(count, 2) ? long : ranked;
  const chosen: typeof ranked = [];
  const pool = [...usable];
  while (chosen.length < count && pool.length > 0) {
    let best = 0;
    for (let index = 1; index < pool.length; index++) {
      const spread = (item: (typeof ranked)[number]) =>
        chosen.length === 0
          ? item.length
          : Math.min(...chosen.map((other) => angularGap(item.bearing, other.bearing))) * 1000 + item.length;
      if (spread(pool[index]) > spread(pool[best])) best = index;
    }
    chosen.push(pool.splice(best, 1)[0]);
  }
  let clone = 0;
  while (chosen.length < count) {
    chosen.push(ranked[clone % ranked.length]);
    clone += 1;
  }
  return chosen.map((item) => item.coords);
}

/**
 * One street trace per feeder, running out from its substation along nearby roads.
 * NeRDA has no cable geometry, so each feeder is given a distinct set of streets
 * in a short walk from the substation. The paths are not SSEN's cables.
 */
export function streetLayout(
  feeders: TraceInput[],
  ways: StreetWay[] = network.ways,
): { traces: StreetTrace[]; stubs: StreetStub[] } {
  const nodes = buildGraph(ways);
  const bySubstation = new Map<string, TraceInput[]>();
  for (const feeder of feeders) {
    const group = bySubstation.get(feeder.substationId) ?? [];
    group.push(feeder);
    bySubstation.set(feeder.substationId, group);
  }
  const sites = [...bySubstation.values()].flatMap((group) => {
    const first = group[0];
    const snap = project(nodes, first.lon, first.lat);
    if (!snap) return [];
    return [{ id: first.substationId, lat: first.lat, lon: first.lon, root: snap.nodeId, feeders: group }];
  });
  const reach = new Map(sites.map((site) => [site.id, distances(nodes, site.root)]));

  const ownerOf = (nodeId: string) => {
    let best: { id: string; distance: number } | null = null;
    for (const site of sites) {
      const distance = reach.get(site.id)?.get(nodeId);
      if (distance === undefined) continue;
      if (!best || distance < best.distance - 0.01 || (Math.abs(distance - best.distance) <= 0.01 && site.id < best.id)) {
        best = { id: site.id, distance };
      }
    }
    return best?.id ?? null;
  };

  const traces: StreetTrace[] = [];
  const stubs: StreetStub[] = [];
  for (const site of sites) {
    const rootNode = nodes.get(site.root);
    if (!rootNode) continue;
    if (metresBetween([site.lon, site.lat], [rootNode.lon, rootNode.lat]) > 3) {
      stubs.push({
        substationId: site.id,
        coordinates: [
          [site.lon, site.lat],
          [rootNode.lon, rootNode.lat],
        ],
      });
    }

    const owned = new Set<string>();
    for (const [nodeId] of nodes) {
      if (ownerOf(nodeId) === site.id) owned.add(nodeId);
    }
    const parent = new Map<string, string | null>([[site.root, null]]);
    const dist = new Map<string, number>([[site.root, 0]]);
    const heap: { id: string; d: number }[] = [{ id: site.root, d: 0 }];
    while (heap.length > 0) {
      heap.sort((a, b) => a.d - b.d);
      const current = heap.shift();
      if (!current || current.d !== dist.get(current.id)) continue;
      for (const edge of nodes.get(current.id)?.out ?? []) {
        if (!owned.has(edge.to)) continue;
        const next = current.d + edge.meters;
        if (next + 0.01 < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, next);
          parent.set(edge.to, current.id);
          heap.push({ id: edge.to, d: next });
        }
      }
    }
    const parents = new Set([...parent.values()].filter((node): node is string => Boolean(node)));
    const isLeaf = (node: string) => node !== site.root && !parents.has(node);
    const leafNodes = [...parent.keys()].filter(isLeaf);
    const paths = leafNodes.map((leaf) => {
      const chain = [leaf];
      let cursor = leaf;
      while (parent.get(cursor)) {
        cursor = parent.get(cursor) ?? site.root;
        chain.push(cursor);
        if (chain.length > parent.size + 1) break;
      }
      chain.reverse();
      const coords: Coord[] = [];
      for (let index = 0; index < chain.length - 1; index++) {
        const edge = nodes.get(chain[index])?.out.find((item) => item.to === chain[index + 1]);
        if (!edge) continue;
        if (coords.length === 0) coords.push(edge.coords[0]);
        for (const coord of edge.coords.slice(1)) coords.push(coord);
      }
      return coords;
    });

    const feederIds = site.feeders.map((feeder) => feeder.id).sort();
    const chosen = pickPaths(paths, feederIds.length);
    const gap = 3.4;
    chosen.forEach((coords, index) => {
      const shift = (index - (chosen.length - 1) / 2) * gap;
      traces.push({
        feederId: feederIds[index],
        substationId: site.id,
        coordinates: [offsetPath(coords, shift)],
      });
    });
  }
  return { traces, stubs };
}
