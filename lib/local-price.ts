/** Energy-only flexibility uplift, priced from demand before battery dispatch. */
export function localPriceSeries(wholesale: Array<number | null>, demand: Array<number | null>, importKw: number, exportKw: number, tariffGbpPerKwh: number | null) {
  return wholesale.map((price, index) => {
    const power = demand[index];
    if (price == null || power == null || tariffGbpPerKwh == null
      || !Number.isFinite(price) || !Number.isFinite(power)) return null;
    if (power > importKw + 1e-6) return price + tariffGbpPerKwh;
    if (power < -exportKw - 1e-6) return price - tariffGbpPerKwh;
    return price;
  });
}
