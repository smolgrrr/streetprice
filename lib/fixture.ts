import { compareFeeders, qualityFor } from "./comparison";
import { ASSUMED_FUSE_AMPS } from "./cohort";
import { capGbpPerMwh, priceParameters, priceWindow, ratingKvaFromAmps } from "./price";
import type { Feeder, Snapshot } from "./types";

const START = Date.parse("2026-09-29T00:00:00.000Z");
const STEP_MS = 30 * 60 * 1000;
const COUNT = 48;

function times(): string[] {
  return Array.from({ length: COUNT }, (_, index) => new Date(START + index * STEP_MS).toISOString());
}

function hourUtc(t: string): number {
  const date = new Date(t);
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

/** Synthetic half-hour wholesale shape used only when no local snapshot exists. */
export function fixtureWholesale(t: string): number {
  const hour = hourUtc(t);
  if (hour >= 17 && hour < 20) return 168;
  if (hour >= 7 && hour < 9) return 104;
  if (hour < 6) return 44;
  if (hour >= 11 && hour < 15) return 58;
  return 79;
}

const sites = [
  { id: "JUXON ST FLATS", name: "Juxon St Flats", lat: 51.759821, lon: -1.269897, feeders: [1, 2, 3] },
  { id: "ST BERNARDS ROAD", name: "St Bernards Road", lat: 51.762019, lon: -1.265716, feeders: [1, 3, 4, 5] },
  { id: "VENABLES CLOSE", name: "Venables Close", lat: 51.760522, lon: -1.267604, feeders: [1, 2, 3, 4, 5] },
] as const;

function syntheticPower(hour: number, offset: number): number {
  const daytime = 24 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
  const evening = hour >= 17 && hour < 21 ? 46 + offset * 4 : 0;
  const exportKw = hour >= 11 && hour < 15 && offset % 3 === 0 ? -48 : 0;
  return 28 + offset * 3 + daytime + evening + exportKw;
}

export function buildFixture(): Snapshot {
  const cap = capGbpPerMwh();
  const clock = times();
  const ratingKva = ratingKvaFromAmps(ASSUMED_FUSE_AMPS);
  let offset = 0;
  const feeders: Feeder[] = sites.flatMap((site) =>
    site.feeders.map((number) => {
      const feederOffset = offset++;
      return {
        id: `${site.id}\nsynthetic_${number}`,
        name: `Feeder ${number}`,
        substationId: site.id,
        substationName: site.name,
        lat: site.lat,
        lon: site.lon,
        ratingKva,
        ratingSource: "assumed-feeder-fuse" as const,
        quality: qualityFor(COUNT, COUNT),
        samples: priceWindow(
          clock.map((t) => ({ t, pKw: syntheticPower(hourUtc(t), feederOffset) })),
          fixtureWholesale,
          ratingKva,
          cap,
        ),
      };
    }),
  );
  return {
    updatedAt: clock.at(-1)!,
    source: "fixture",
    mode: "synthetic",
    window: {
      start: clock[0],
      end: new Date(START + 24 * 60 * 60 * 1000).toISOString(),
      dataThrough: clock.at(-1)!,
    },
    capGbpPerMwh: cap,
    ratingAssumptionAmps: ASSUMED_FUSE_AMPS,
    parameters: { ...priceParameters },
    comparison: compareFeeders(feeders),
    feeders,
  };
}
