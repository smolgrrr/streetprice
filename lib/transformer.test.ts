import { expect, it } from "vitest";
import { loadSnapshot } from "./snapshot";
import { monitoredPowerAt, transformerFor, transformerNrn } from "./transformer";

it("matches the parent asset without allocating its rating to a feeder", async () => {
  const snapshot = await loadSnapshot();
  const feeder = snapshot.feeders.find((item) => item.id.startsWith("ASHMOLEON"))!;
  expect(transformerNrn(feeder)).toBe("4626002080");
  expect(transformerNrn({ id: "synthetic" })).toBeNull();
  expect(transformerFor([feeder], snapshot)?.ratingKva).toBe(1500);
  expect(transformerFor(snapshot.feeders, snapshot)).toBeUndefined();
  expect(monitoredPowerAt([feeder], feeder.samples[0].t)).toBe(feeder.samples[0].pKw);
});

it("sums signed power but never fills a missing circuit with zero", async () => {
  const snapshot = await loadSnapshot();
  const base = snapshot.feeders[0];
  const t = base.samples[0].t;
  const imported = { ...base, samples: [{ ...base.samples[0], pKw: 100 }] };
  const exported = { ...base, samples: [{ ...base.samples[0], pKw: -20 }] };
  expect(monitoredPowerAt([imported, exported], t)).toBe(80);
  expect(monitoredPowerAt([imported, { ...exported, samples: [] }], t)).toBeNull();
  expect(monitoredPowerAt([], t)).toBeNull();
});
