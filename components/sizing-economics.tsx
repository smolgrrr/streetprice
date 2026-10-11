import type { FeederSizingCurve } from "@/lib/sizing-equilibrium";
import type { Feeder } from "@/lib/types";
import type { PriceParameters } from "@/lib/price";

const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
const kw = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kW`;

export function SizingEconomics({ sizing, homes, parameters, feeder }: {
  sizing?: FeederSizingCurve; homes: number; parameters: PriceParameters; feeder: Feeder;
}) {
  const point = sizing?.points[homes];
  const baseline = sizing?.points[0];
  const scale = baseline ? 150 / Math.max(1, baseline.annualAssetGbp) : 1;
  return <section className="section narrative-section money-section" aria-labelledby="money-title">
    <div className="section-heading"><div><p className="eyebrow">03 / Energy-only flexibility</p><h2 id="money-title">What size pays off?</h2><p className="section-lede">{feeder.substationName} / {feeder.name} · hypothetical asset built to serve recorded demand.</p></div></div>
    {!point || !baseline || !sizing ? <p className="chart-note">Annual sizing is unavailable for this feeder; no tariff or saving is estimated.</p> : <>
      <div className="money-headline"><span>Minimum feasible feeder at this adoption</span><p>{kw(baseline.capacityKw)} <span>→</span> <strong>{kw(point.capacityKw)}</strong></p><small>{homes} of 60 assumed households with a battery</small></div>
      <dl className="annual-sizing sizing-summary">
        <div><dt>Energy-only VPP tariff</dt><dd>{point.tariffGbpPerKwh === null ? "—" : `${(point.tariffGbpPerKwh * 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}p/kWh`}</dd></div>
        <div><dt>Annual dispatched energy</dt><dd>{Math.round(point.dispatchedKwh).toLocaleString("en-GB")} kWh</dd></div>
        <div><dt>Annual VPP payment</dt><dd>{money(point.annualPaymentGbp)}</dd></div>
      </dl>
      <div className="flow-scroll"><svg className="money-flow" viewBox="0 0 960 525" role="img" aria-label="Annual cost flow comparing feeder assets alone with smaller feeder assets plus energy-only VPP payments">
        <title>Annual network cost flow</title>
        {[
          { label: "No batteries", y: 70, assets: baseline.annualAssetGbp, payment: 0 },
          { label: `${homes} battery homes`, y: 310, assets: point.annualAssetGbp, payment: point.annualPaymentGbp },
        ].map(row => {
          const assetHeight = row.assets * scale;
          const paymentHeight = row.payment * scale;
          return <g key={row.label}>
            <text x="0" y={row.y - 20} className="flow-title">{row.label}</text>
            <text x="0" y={row.y + 17}>{money(row.assets + row.payment)} / year</text>
            <text x="0" y={row.y + 38} className="flow-muted">Network cost recovered from bills</text>
            <rect x="235" y={row.y} width="8" height={assetHeight + paymentHeight} fill="#273442" />
            <path d={`M243 ${row.y} C410 ${row.y}, 455 ${row.y}, 620 ${row.y} L620 ${row.y + assetHeight} C455 ${row.y + assetHeight}, 410 ${row.y + assetHeight}, 243 ${row.y + assetHeight} Z`} fill="#c5ccd3" />
            {paymentHeight > 0 ? <path d={`M243 ${row.y + assetHeight} C410 ${row.y + assetHeight}, 455 ${row.y + assetHeight + 12}, 620 ${row.y + assetHeight + 12} L620 ${row.y + assetHeight + 12 + paymentHeight} C455 ${row.y + assetHeight + paymentHeight}, 410 ${row.y + assetHeight + paymentHeight}, 243 ${row.y + assetHeight + paymentHeight} Z`} fill="#1e7f66" opacity=".8" /> : null}
            <text x="642" y={row.y + 14}>Installed feeder</text><text x="642" y={row.y + 33} className="flow-muted">{money(row.assets)} / year</text>
            {paymentHeight > 0 ? <><text x="642" y={row.y + assetHeight + 26}>VPP energy dispatch</text><text x="642" y={row.y + assetHeight + 45} className="flow-muted">{money(row.payment)} / year</text></> : null}
          </g>;
        })}
      </svg></div>
      <table className="cost-table"><caption>Annual network cost under the sizing assumption</caption><thead><tr><th>Cost</th><th>No batteries</th><th>{homes} battery homes</th></tr></thead><tbody>
        <tr><td>Installed feeder capacity</td><td>{money(baseline.annualAssetGbp)}</td><td>{money(point.annualAssetGbp)}</td></tr>
        <tr><td>Energy-only VPP payments</td><td>£0</td><td>{money(point.annualPaymentGbp)}</td></tr>
        <tr><th>Total</th><td>{money(baseline.annualAssetGbp)}</td><td>{money(point.annualAssetGbp + point.annualPaymentGbp)}</td></tr>
      </tbody></table>
      <p className="chart-note">{money(Math.abs(point.annualSavingGbp))} per year {point.annualSavingGbp >= 0 ? "lower" : "higher"} than sizing to the observed peak. The tariff values the marginal kW of capacity saved across the {point.constrainedHours.toLocaleString("en-GB", { maximumFractionDigits: 1 })} recorded hours above the proposed size. Payments apply only to energy dispatched.</p>
      <details className="signal-details"><summary>Cost and reliability assumptions</summary><p className="chart-note">Capacity costs £{parameters.gbpPerKva}/kVA, annualised over {parameters.lifeYears} years at {parameters.discountRate * 100}% and unity power factor. No separate upgrade or downgrade cost, availability payment, battery purchase cost, VPP margin, charging energy or degradation cost is included. Battery adoption is assumed; this tariff is not evidence that owners would accept it. The feasibility calculation carries battery charge across the recorded year, requires it to finish full, and assumes 10 kW / 25 kWh per participating home with 95% one-way efficiency. It covers {sizing.observedBuckets.toLocaleString("en-GB")} of {sizing.expectedBuckets.toLocaleString("en-GB")} half-hours; missing load, future growth, voltage, phase imbalance and outages are not verified.</p></details>
    </>}
  </section>;
}
