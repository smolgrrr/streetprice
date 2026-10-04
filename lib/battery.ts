export const battery = {
  dischargeKwh: 10,
  roundTrip: 0.9,
} as const;

export type Cycle = {
  buyAt: string;
  sellAt: string;
  buyGbpPerMwh: number;
  sellGbpPerMwh: number;
  profitGbp: number;
};

/** Pounds for one cycle that discharges `dischargeKwh` after a round trip. */
export function cycleProfitGbp(
  buyGbpPerMwh: number,
  sellGbpPerMwh: number,
  dischargeKwh = battery.dischargeKwh,
  roundTrip = battery.roundTrip,
): number {
  const chargeKwh = dischargeKwh / roundTrip;
  return (dischargeKwh * sellGbpPerMwh - chargeKwh * buyGbpPerMwh) / 1000;
}

/** Best hindsight cycle whose charge is strictly before its discharge. */
export function bestCycle(points: { t: string; gbpPerMwh: number }[]): Cycle | null {
  if (points.length < 2) return null;
  let best: Cycle | null = null;
  for (let buy = 0; buy < points.length; buy++) {
    for (let sell = buy + 1; sell < points.length; sell++) {
      const profitGbp = cycleProfitGbp(points[buy].gbpPerMwh, points[sell].gbpPerMwh);
      if (!best || profitGbp > best.profitGbp) {
        best = {
          buyAt: points[buy].t,
          sellAt: points[sell].t,
          buyGbpPerMwh: points[buy].gbpPerMwh,
          sellGbpPerMwh: points[sell].gbpPerMwh,
          profitGbp,
        };
      }
    }
  }
  return best;
}
