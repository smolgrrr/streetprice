import { describe, expect, it } from "vitest";
import { bestCycle, cycleProfitGbp } from "./battery";
import { addonColor, ratioColor } from "./color";
import { compareFeeders, qualityFor, swing } from "./comparison";
import { parseMarketIndex, wholesaleAt } from "./elexon";
import { buildFixture } from "./fixture";
import { mergeAnalogSeries, parseAnalogSeries, parseValueHistory, threePhasePowerKw } from "./nerda";
import {
  addonGbpPerMwh,
  capGbpPerMwh,
  currentLoading,
  flatTargetKw,
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
  it("uses signed power so equal import and export balance at zero", () => {
    expect(flatTargetKw([100, -100])).toBe(0);
  });

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
    expect(addonColor(-300, 300)).toBe("rgb(62 106 225)");
    expect(addonColor(300, 300)).toBe("rgb(225 6 0)");
    expect(addonColor(0, 300)).toBe("rgb(154 163 171)");
  });

  it("colours local ÷ wholesale from blue through grey to red", () => {
    expect(ratioColor(0.5)).toBe("rgb(62 106 225)");
    expect(ratioColor(1)).toBe("rgb(214 214 210)");
    expect(ratioColor(2)).toBe("rgb(225 6 0)");
    expect(ratioColor(-1)).toBe("rgb(37 78 196)");
    expect(ratioColor(4)).toBe("rgb(225 6 0)");
  });
});

describe("fixture", () => {
  const snapshot = buildFixture();

  it("covers the three pilot substations and twelve feeders over 24 hours", () => {
    expect(new Set(snapshot.feeders.map((feeder) => feeder.substationId)).size).toBe(3);
    expect(snapshot.feeders).toHaveLength(12);
    expect(snapshot.feeders[0].samples).toHaveLength(48);
  });

  it("marks itself as a synthetic fallback", () => {
    expect(snapshot.mode).toBe("synthetic");
    expect(snapshot.source).toBe("fixture");
    expect(snapshot.comparison.feederCount).toBe(12);
  });
});

describe("research comparison", () => {
  it("compares the median feeder add-on swing with wholesale swing", () => {
    const snapshot = buildFixture();
    const result = compareFeeders(snapshot.feeders);
    expect(result.localSwingGbpPerMwh).toBeGreaterThan(0);
    expect(result.wholesaleSwingGbpPerMwh).toBe(swing([44, 168]));
    expect(result.ratio).toBeCloseTo(
      result.localSwingGbpPerMwh / result.wholesaleSwingGbpPerMwh,
    );
  });

  it("returns no ratio when wholesale has no range", () => {
    const snapshot = buildFixture();
    const feeders = snapshot.feeders.map((feeder) => ({
      ...feeder,
      samples: feeder.samples.map((sample) => ({ ...sample, wholesale: 50 })),
    }));
    expect(compareFeeders(feeders).ratio).toBeNull();
  });

  it("applies the documented quality thresholds", () => {
    expect(qualityFor(40, 48).status).toBe("good");
    expect(qualityFor(24, 48).status).toBe("partial");
    expect(qualityFor(23, 48).status).toBe("insufficient");
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

  it("reads real NeRDA phase payloads, buckets readings, and omits incomplete buckets", () => {
    const payload = {
      AnalogValues: [
        {
          aliasName: "VNH.feeder1.p1",
          value_history: [
            { __ts: "2026-09-29T00:01:00Z", value: 1 },
            { __ts: "2026-09-29T00:11:00Z", value: 3 },
            { __ts: "2026-09-29T00:31:00Z", value: 10 },
          ],
        },
        {
          aliasName: "VNH.feeder1.p2",
          value_history: [{ _ts: "2026-09-29T00:05:00Z", value: 2 }],
        },
        {
          aliasName: "VNH.feeder1.p3",
          value_history: [{ __ts: "2026-09-29T00:20:00Z", value: -1 }],
        },
      ],
    };
    const analogs = parseAnalogSeries(payload);
    expect(analogs).toHaveLength(3);
    expect(threePhasePowerKw(analogs, 1)).toEqual([
      { t: "2026-09-29T00:00:00.000Z", value: 3 },
    ]);
  });

  it("deduplicates repeated timestamps in one analog", () => {
    const analogs = parseAnalogSeries({
      AnalogValues: [
        {
          aliasName: "feeder.p1",
          value_history: [
            { __ts: "2026-09-29T00:01:00Z", value: 1 },
            { __ts: "2026-09-29T00:01:00Z", value: 4 },
          ],
        },
      ],
    });
    expect(analogs[0].points).toEqual([{ t: "2026-09-29T00:01:00.000Z", value: 4 }]);
  });

  it("merges six-hour pages without duplicating their boundary reading", () => {
    const merged = mergeAnalogSeries([
      { aliasName: "feeder.p1", name: "", unit: "kW", points: [{ t: "2026-09-29T06:00:00.000Z", value: 1 }] },
      {
        aliasName: "feeder.p1",
        name: "",
        unit: "kW",
        points: [
          { t: "2026-09-29T06:00:00.000Z", value: 1 },
          { t: "2026-09-29T06:30:00.000Z", value: 2 },
        ],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].points).toHaveLength(2);
  });
});
