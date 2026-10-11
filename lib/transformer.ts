import type { Feeder, Snapshot } from "./types";

export function transformerNrn(feeder: Pick<Feeder, "id">): string | null {
  const circuit = feeder.id.split("\n")[1]?.replaceAll("_", "");
  return circuit && /^\d{12}$/.test(circuit) ? circuit.slice(0, 10) : null;
}

export function transformerFor(feeders: Feeder[], snapshot: Snapshot) {
  const nrns = new Set(feeders.map(transformerNrn));
  if (nrns.size !== 1) return undefined;
  return snapshot.transformerRatings?.find((rating) => rating.nrn === [...nrns][0]);
}

/** Sum monitored circuits only. A missing monitored circuit creates a gap,
 * not a zero. This is not total transformer load unless inventory is covered. */
export function monitoredPowerAt(feeders: Feeder[], t: string): number | null {
  if (!feeders.length) return null;
  const readings = feeders.map((feeder) => feeder.samples.find((sample) => sample.t === t));
  if (readings.some((reading) => !reading || !Number.isFinite(reading.pKw))) return null;
  return readings.reduce((sum, reading) => sum + reading!.pKw, 0);
}
