import { expect, it } from "vitest";
import { localPriceSeries } from "./local-price";

it("follows wholesale until capacity binds, then applies the energy-only tariff", () => {
  const prices = localPriceSeries([.05, .08, .1, .12], [40, 71.2, 76.9, 119], 71.2, 71.2, .005);
  [.05, .08, .105, .125].forEach((expected, index) => expect(prices[index]).toBeCloseTo(expected));
  expect(localPriceSeries([.05, .08], [76.9, 119], 138.6, 100, .005)).toEqual([.05, .08]);
});

it("lowers the local price for excess export and preserves missing readings", () => {
  const values = localPriceSeries([.05, .08, null, .1], [-80, null, 120, NaN], 70, 70, .005);
  expect(values[0]).toBeCloseTo(.045);
  expect(values.slice(1)).toEqual([null, null, null]);
  expect(localPriceSeries([.05], [120], 70, 70, null)).toEqual([null]);
});
