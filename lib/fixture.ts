import { capGbpPerMwh, priceParameters, priceWindow } from "./price";
import type { Feeder, Snapshot } from "./types";

const START = Date.parse("2026-10-03T12:00:00.000Z");
const STEP_MS = 10 * 60 * 1000;
const COUNT = 144;

function times(): string[] {
  return Array.from({ length: COUNT }, (_, index) => new Date(START + index * STEP_MS).toISOString());
}

function hourUtc(t: string): number {
  const date = new Date(t);
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

/** Stepwise half-hour shape, cheap overnight and dear through the evening. */
export function fixtureWholesale(t: string): number {
  const block = Math.floor(hourUtc(t) * 2) / 2;
  if (block >= 17 && block < 20) return 190;
  if (block >= 16 && block < 17) return 120;
  if (block >= 7 && block < 9) return 110;
  if (block >= 0 && block < 6) return 42;
  if (block >= 11 && block < 15) return 55;
  return 78;
}

function eveningKw(hour: number): number {
  if (hour >= 17 && hour < 21) return 170;
  if (hour >= 0 && hour < 6) return 15;
  return 40;
}

function solarKw(hour: number): number {
  if (hour >= 10 && hour < 15) return -80;
  if (hour >= 17 && hour < 20) return 45;
  return 20;
}

function morningKw(hour: number): number {
  if (hour >= 7 && hour < 10) return 150;
  return 30;
}

function mildKw(hour: number): number {
  return 40 + 10 * Math.sin((hour / 24) * Math.PI * 2);
}

type Draft = {
  id: string;
  name: string;
  substationId: string;
  substationName: string;
  lat: number;
  lon: number;
  ratingKva: number;
  power: (hour: number) => number;
};

const drafts: Draft[] = [
  {
    id: "cowley-between-towns",
    name: "Between Towns Road",
    substationId: "cowley",
    substationName: "Cowley Road",
    lat: 51.7304,
    lon: -1.2138,
    ratingKva: 200,
    power: eveningKw,
  },
  {
    id: "cowley-crowell",
    name: "Crowell Road",
    substationId: "cowley",
    substationName: "Cowley Road",
    lat: 51.7304,
    lon: -1.2138,
    ratingKva: 120,
    power: solarKw,
  },
  {
    id: "cowley-barns",
    name: "Barns Road",
    substationId: "cowley",
    substationName: "Cowley Road",
    lat: 51.7304,
    lon: -1.2138,
    ratingKva: 250,
    power: () => 40,
  },
  {
    id: "headington-london",
    name: "London Road",
    substationId: "headington",
    substationName: "Headington",
    lat: 51.7582,
    lon: -1.2114,
    ratingKva: 160,
    power: morningKw,
  },
  {
    id: "headington-old",
    name: "Old Road",
    substationId: "headington",
    substationName: "Headington",
    lat: 51.7582,
    lon: -1.2114,
    ratingKva: 300,
    power: mildKw,
  },
];

export function buildFixture(): Snapshot {
  const cap = capGbpPerMwh();
  const clock = times();
  const feeders: Feeder[] = drafts.map((draft) => ({
    id: draft.id,
    name: draft.name,
    substationId: draft.substationId,
    substationName: draft.substationName,
    lat: draft.lat,
    lon: draft.lon,
    ratingKva: draft.ratingKva,
    ratingSource: "kva",
    samples: priceWindow(
      clock.map((t) => ({ t, pKw: draft.power(hourUtc(t)) })),
      fixtureWholesale,
      draft.ratingKva,
      cap,
    ),
  }));
  return {
    updatedAt: clock[clock.length - 1],
    source: "fixture",
    capGbpPerMwh: cap,
    parameters: { ...priceParameters },
    feeders,
  };
}
