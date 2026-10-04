import { describe, expect, it } from "vitest";
import { bestCycle, cycleProfitGbp } from "./battery";
import { addonColor } from "./color";
import { parseMarketIndex, wholesaleAt } from "./elexon";
import { buildFixture } from "./fixture";
import { parseValueHistory } from "./nerda";
import {
  addonGbpPerMwh,
  capGbpPerMwh,
  currentLoading,
  priceWindow,
  ratingKvaFromAmps,
  sumPhasePowerW,
} from "./price";

describe("cap", () => {
  it("annualises £80/kVA over 45 years and 15 binding hours", () => {
    const cap = capGbpPerMwh();
    expect(cap).toBeGreaterThan(290);
    expect(cap).toBeLessThan(310);
  });
});

describe("add-on", () => {
  const cap = 300;

  it("is zero on the flat target", () => {
    expect(addonGbpPerMwh(100, 100, 200, cap)).toBe(0);
  });

  it("reaches the cap half a rating above the target", () => {
    expect(addonGbpPerMwh(200, 100, 200, cap)).toBe(cap);
  });

  it("pays a battery to charge when the feeder is exporting", () => {
    expect(addonGbpPerMwh(-100, 0, 200, cap)).toBe(-cap);
  });

  it("saturates past the cap", () => {
    expect(addonGbpPerMwh(500, 0, 200, cap)).toBe(cap);
    expect(addonGbpPerMwh(-500, 0, 200, cap)).toBe(-cap);
  });
});

describe("feeder measurements", () => {
  it("sums phase watts", () => {
    expect(sumPhasePowerW([1000, 2000, -500])).toBe(2500);
  });

  it("converts an amp limit to three-phase kVA at 400 V", () => {
    expect(ratingKvaFromAmps(100)).toBeCloseTo(Math.sqrt(3) * 0.4 * 100);
  });

  it("uses the hottest phase for loading", () => {
    expect(currentLoading([10, -40, 20], 50)).toBeCloseTo(0.8);
  });
});

describe("window", () => {
  it("prices every sample against one flat target", () => {
    const samples = priceWindow(
      [
        { t: "2026-10-04T00:00:00.000Z", pKw: 0 },
        { t: "2026-10-04T12:00:00.000Z", pKw: 100 },
      ],
      () => 50,
      100,
      300,
    );
    expect(samples[0].targetKw).toBe(50);
    expect(samples[1].targetKw).toBe(50);
    expect(samples[1].local).toBe(50 + samples[1].addon);
    expect(samples[1].addon).toBeGreaterThan(0);
    expect(samples[0].addon).toBeLessThan(0);
  });
});

describe("battery", () => {
  it("charges 10 kWh out of a 90% round trip", () => {
    const profit = cycleProfitGbp(5, 80);
    expect(profit).toBeCloseTo((10 * 80 - (10 / 0.9) * 5) / 1000);
  });

  it("requires the charge to come before the discharge", () => {
    const cycle = bestCycle([
      { t: "a", gbpPerMwh: 100 },
      { t: "b", gbpPerMwh: 10 },
      { t: "c", gbpPerMwh: 80 },
      { t: "d", gbpPerMwh: 5 },
    ]);
    expect(cycle?.buyAt).toBe("b");
    expect(cycle?.sellAt).toBe("c");
  });
});

describe("colour", () => {
  it("is teal at a full charge add-on and cadmium at a full discharge add-on", () => {
    expect(addonColor(-300, 300)).toBe("rgb(15 110 106)");
    expect(addonColor(300, 300)).toBe("rgb(210 69 30)");
    expect(addonColor(0, 300)).toBe("rgb(23 32 42)");
  });
});

describe("fixture", () => {
  const snapshot = buildFixture();

  it("covers two substations and five feeders over 24 hours", () => {
    expect(new Set(snapshot.feeders.map((feeder) => feeder.substationId)).size).toBe(2);
    expect(snapshot.feeders).toHaveLength(5);
    expect(snapshot.feeders[0].samples).toHaveLength(144);
  });

  it("pays discharge on the evening feeder and charge on the solar feeder", () => {
    const evening = snapshot.feeders.find((feeder) => feeder.id === "cowley-between-towns");
    const solar = snapshot.feeders.find((feeder) => feeder.id === "cowley-crowell");
    const flat = snapshot.feeders.find((feeder) => feeder.id === "cowley-barns");
    expect(Math.max(...evening!.samples.map((sample) => sample.addon))).toBeCloseTo(
      snapshot.capGbpPerMwh,
    );
    expect(Math.min(...solar!.samples.map((sample) => sample.addon))).toBeLessThan(
      -0.9 * snapshot.capGbpPerMwh,
    );
    expect(Math.max(...flat!.samples.map((sample) => Math.abs(sample.addon)))).toBe(0);
  });
});

describe("parsers", () => {
  it("reads an Elexon market index payload", () => {
    const points = parseMarketIndex({
      data: [
        { startTime: "2026-10-03T14:00:00Z", price: 136.73 },
        { startTime: "2026-10-03T13:30:00Z", price: 135.36 },
      ],
    });
    expect(points.map((point) => point.gbpPerMwh)).toEqual([135.36, 136.73]);
    expect(wholesaleAt(points, "2026-10-03T13:45:00.000Z")).toBe(135.36);
    expect(wholesaleAt(points, "2026-10-03T14:10:00.000Z")).toBe(136.73);
  });

  it("prefers the RMS analog in a NeRDA history", () => {
    const points = parseValueHistory({
      AnalogValues: [
        {
          aliasName: "FEEDER-MIN",
          value_history: [{ _ts: "2026-10-04T12:00:00Z", value: 1 }],
        },
        {
          aliasName: "FEEDER-RMS",
          value_history: [{ _ts: "2026-10-04T12:00:00Z", value: 9 }],
        },
      ],
    });
    expect(points).toEqual([{ t: "2026-10-04T12:00:00.000Z", value: 9 }]);
  });
});
