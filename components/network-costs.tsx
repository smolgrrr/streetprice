import type { AnnualFeederCosts, Feeder } from "@/lib/types";
import { formatUsdFromGbp, USD_PER_GBP, USD_RATE_SOURCE } from "@/lib/format";

// Commons Library CBP-10505, table on p. 6, based on Ofgem Annex 9.
// Supplier combines operating, debt and industry charges (16.2%) and EBIT (2.5%).
// Other combines policy (8.9%), VAT (4.8%) and other allowances (2%).
const bill = [
  { label: "Buying electricity", recipient: "Wholesale", share: 38.1, color: "#435368", detail: "What suppliers pay to buy power" },
  { label: "Getting it to you", recipient: "Networks", share: 27.5, color: "#1e7f66", detail: "Power lines, substations and keeping the grid running" },
  { label: "Running the supplier", recipient: "Supplier", share: 18.7, color: "#a65c35", detail: "Billing, meters, other costs and profit allowance" },
  { label: "Other charges", recipient: "Other", share: 15.7, color: "#72738c", detail: "Government schemes, VAT and other allowances" },
] as const;

const source = "https://researchbriefings.files.parliament.uk/documents/CBP-10505/CBP-10505.pdf#page=6";

function BillPie() {
  let position = 0;
  const point = (share: number) => {
    const angle = 2 * Math.PI * share / 100;
    return `${100 + 90 * Math.sin(angle)} ${100 - 90 * Math.cos(angle)}`;
  };

  return <>
    <svg className="cost-pie" viewBox="0 0 200 200" role="img" aria-label="Breakdown of a 100 US dollar example electricity bill">
      {bill.map(({ label, share, color }) => {
        const start = point(position);
        position += share;
        return <path key={label} d={`M100 100 L${start} A90 90 0 0 1 ${point(position)} Z`} fill={color} stroke="white" strokeWidth="1.5">
          <title>{`${label}: $${share.toFixed(2)} per $100`}</title>
        </path>;
      })}
    </svg>
    <dl className="cost-legend">
      {bill.map(({ label, share, color, detail }) => <div key={label}>
        <dt><i style={{ background: color }} /><span>{label}<small>{detail}</small></span></dt>
        <dd>${share.toFixed(2)}</dd>
      </div>)}
    </dl>
  </>;
}

function MoneyFlow() {
  let position = 0;
  return <svg className="money-sankey" viewBox="0 0 360 210" role="img" aria-labelledby="money-flow-title money-flow-description">
    <title id="money-flow-title">Where your electricity payment goes</title>
    <desc id="money-flow-description">You pay your energy supplier. The bill covers wholesale electricity, network charges, supplier costs and other charges. The widths show each share of the bill.</desc>
    <text x="180" y="17" textAnchor="middle" className="flow-label">You pay your supplier</text>
    <rect x="40" y="32" width="280" height="8" fill="#1e2a35" />
    {bill.map(({ recipient, share, color }, index) => {
      const width = 280 * share / 100;
      const top = 40 + position;
      const bottom = 10 + position + index * 20;
      position += width;
      return <g key={recipient}>
        <path d={`M${top} 40 C${top} 92 ${bottom} 92 ${bottom} 144 H${bottom + width} C${bottom + width} 92 ${top + width} 92 ${top + width} 40 Z`} fill={color} fillOpacity=".28">
          <title>{`${recipient}: $${share.toFixed(2)} per $100`}</title>
        </path>
        <rect x={bottom} y="144" width={width} height="8" fill={color} />
        <text x={bottom + width / 2} y="174" textAnchor="middle" className="flow-label">{recipient}</text>
        <text x={bottom + width / 2} y="193" textAnchor="middle">${share.toFixed(2)}</text>
      </g>;
    })}
  </svg>;
}

export function NetworkCosts({ feeder, baseline, selected }: {
  feeder: Feeder;
  baseline?: AnnualFeederCosts;
  selected?: AnnualFeederCosts;
}) {
  const before = baseline?.assetsGbp;
  const after = selected && selected.assetsGbp + selected.vppGbp;

  return <section className="section costs-section" id="follow-the-money" aria-labelledby="costs-title">
    <p className="eyebrow">Follow the money</p>
    <h2 id="costs-title">What are you paying for?</h2>
    <p className="section-lede">Even if electricity were free to generate, you’d still pay to get it to your home.</p>
    <div className="costs-grid">
      <figure><h3>What’s in a $100 electricity bill?</h3><BillPie /></figure>
      <figure><h3>Where does the money go?</h3><MoneyFlow />
        <figcaption>Your supplier buys power on the wholesale market and pays network companies to deliver it.</figcaption>
      </figure>
    </div>
    <p className="figure-note"><a href={source}>GB price cap example, Apr–Jun 2026</a> · Electricity only, scaled to US $100. Model prices use <a href={USD_RATE_SOURCE}>1 GBP = ${USD_PER_GBP.toFixed(2)} USD</a> (13 Nov 2026, rounded).</p>
    <div className="battery-cost-note">
      <h3>Where batteries fit</h3>
      <p>Wires are built for the busiest hours. A network can pay battery owners to take pressure off at those times, making better use of the wires already there.</p>
      {before != null && after != null && selected && selected.vppGbp > 0 ? <p className="figure-note">{feeder.substationName} / {feeder.name}: in this model, annual feeder costs go from {formatUsdFromGbp(before)} without batteries to {formatUsdFromGbp(after)}, including {formatUsdFromGbp(selected.vppGbp)} paid for battery response. These are costs for the whole feeder, not one household’s bill.</p> : null}
    </div>
  </section>;
}
