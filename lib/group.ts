import type { Feeder } from "./types";

export function substationsOf(feeders: Feeder[]) {
  const groups = new Map<
    string,
    { id: string; name: string; lat: number; lon: number; feeders: Feeder[] }
  >();
  for (const feeder of feeders) {
    const existing = groups.get(feeder.substationId);
    if (existing) {
      existing.feeders.push(feeder);
      continue;
    }
    groups.set(feeder.substationId, {
      id: feeder.substationId,
      name: feeder.substationName,
      lat: feeder.lat,
      lon: feeder.lon,
      feeders: [feeder],
    });
  }
  return [...groups.values()];
}

export function sampleNearest(feeder: Feeder, t: string) {
  if (feeder.samples.length === 0) return undefined;
  const exact = feeder.samples.find((sample) => sample.t === t);
  if (exact) return exact;
  const target = Date.parse(t);
  let best = feeder.samples[0];
  let bestDistance = Math.abs(Date.parse(best.t) - target);
  for (const sample of feeder.samples) {
    const distance = Math.abs(Date.parse(sample.t) - target);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  return best;
}
