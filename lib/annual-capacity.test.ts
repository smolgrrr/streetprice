import { describe, expect, it } from "vitest";
import { annualCapacity, annualWindow, dailyMaxima, daysInWindow, previous24Hours, type DailyMaxima } from "./annual-capacity";
import { dayBounds } from "./constraint";

const start = new Date("2025-01-01T00:00:00Z"), end = new Date("2026-01-01T00:00:00Z");
function year() {
  return Object.fromEntries(daysInWindow(start, end).map(day => [day,
    { buckets: dayBounds(day).buckets, importKw: 100, exportKw: 0 } satisfies DailyMaxima]));
}

describe("rolling display and annual windows", () => {
  it("ends at the last completed half-hour, not a future bucket", () => {
    const result = previous24Hours(new Date("2026-10-10T00:27:00Z"));
    expect(result.end.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(result.start.toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });
  it("uses complete London days over twelve calendar months", () => {
    const result = annualWindow(new Date("2026-09-30T21:00:00Z"));
    expect(result.start.toISOString()).toBe("2025-09-29T23:00:00.000Z");
    expect(result.end.toISOString()).toBe("2026-09-29T23:00:00.000Z");
    expect(daysInWindow(result.start, result.end)).toHaveLength(365);
    expect(daysInWindow(new Date("2023-03-01T00:00:00Z"), new Date("2024-03-01T00:00:00Z"))).toHaveLength(366);
  });
});

describe("average daily directional maxima", () => {
  it("does not halve asset size when seasonal peaks change direction", () => {
    const days = year();
    Object.values(days).forEach((day, index) => {
      day.importKw = index % 2 ? 100 : 0;
      day.exportKw = index % 2 ? 0 : 100;
    });
    const result = annualCapacity(days, start, end);
    expect(result.assetKw).toBe(100);
    expect(result.meanDailyMaxImportKw).toBeCloseTo(18200 / 365);
    expect(result.meanDailyMaxExportKw).toBeCloseTo(18300 / 365);
  });
  it("takes maxima before averaging, and counts observed no-export days as zero", () => {
    const days = year();
    days["2025-01-01"].importKw = 465;
    days["2025-01-01"].exportKw = 730;
    const result = annualCapacity(days, start, end);
    expect(result.meanDailyMaxImportKw).toBeCloseTo(101);
    expect(result.meanDailyMaxExportKw).toBeCloseTo(2);
    expect(result.assetKw).toBeCloseTo((730 + 364 * 100) / 365);
    days["2025-01-01"].exportKw = 73000;
    expect(annualCapacity(days, start, end).assetKw).toBeCloseTo((73000 + 364 * 100) / 365);
  });
  it("does not turn missing days into zero demand", () => {
    const days = year();
    delete days["2025-01-01"];
    const result = annualCapacity(days, start, end);
    expect(result.status).toBe("ready");
    expect(result.coveredDays).toBe(364);
    expect(result.meanDailyMaxImportKw).toBe(100);
  });
  it("rejects a short year, insufficient day coverage, or a missing season", () => {
    expect(annualCapacity(year(), start, new Date("2025-12-01T00:00:00Z")).status).toBe("insufficient");
    const days = year();
    for (const day of Object.keys(days)) days[day].buckets = 10;
    expect(annualCapacity(days, start, end).assetKw).toBeNull();
    const seasonal = year();
    for (const day of Object.keys(seasonal).filter(day => day.startsWith("2025-01"))) delete seasonal[day];
    expect(annualCapacity(seasonal, start, end).status).toBe("insufficient");
  });
  it("uses the actual 46/50 DST buckets and de-duplicates timestamps", () => {
    const days = year();
    expect(dayBounds("2025-03-30").buckets).toBe(46);
    expect(dayBounds("2025-10-26").buckets).toBe(50);
    days["2025-03-30"].buckets = 23;
    days["2025-10-26"].buckets = 25;
    expect(annualCapacity(days, start, end).coveredDays).toBe(365);
    const t = "2025-01-01T00:00:00Z";
    const daily = dailyMaxima([{ t, value: 20 }, { t, value: 20 }, { t: "2025-01-01T00:30:00Z", value: -30 }], start, end);
    expect(daily["2025-01-01"]).toEqual({ buckets: 2, importKw: 20, exportKw: 30 });
  });
});
