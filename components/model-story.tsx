import { SeriesChart } from "./charts";
import { useState } from "react";
import { CapacityDurationChart } from "./capacity-duration";
import { formatKw, formatPct, formatTime, formatStamp, formatDate } from "@/lib/format";
import type { BatteryScenario, FlexResult, ViewScenario } from "@/lib/flexibility";
import { assumedHouseholdsPerFeeder, simulateFlexibility } from "@/lib/flexibility";
import type { AnnualCapacity, Feeder, WorstDay } from "@/lib/types";
import { alignWorstDay, simulateWorstDay } from "@/lib/worst-day";
import { alignTimeProfile } from "@/lib/capacity-duration";
import type { PriceParameters } from "@/lib/price";
import type { FeederSizingCurve } from "@/lib/sizing-equilibrium";

const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
const capacityLabel = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kW`;

export function StoryHero({ feeder, annualHistory, sizing, worstDay, annualCoverage, result, config, parameters, clock, cursor, scenario, historyWindow, windowLabel, batteryShare, onBatteryShare, onSeek }: {
  feeder: Feeder; result: FlexResult; config: BatteryScenario; parameters: PriceParameters;
  worstDay?: WorstDay | null; annualCoverage?: number;
  annualHistory?: AnnualCapacity;
  sizing?: FeederSizingCurve;
  clock: string[]; cursor: number; scenario: ViewScenario; historyWindow?: { start: string; end: string }; windowLabel: string;
  batteryShare: number; onBatteryShare: (percent: number) => void; onSeek: (index: number) => void;
}) {
  const enabled = scenario !== "none" && result.sizingAvailable;
  const longTerm = scenario === "long-term";
  const [showPercentiles, setShowPercentiles] = useState(false);
  const sizingPoint = sizing?.points[enabled ? config.households : 0];
  const proposedKw = sizingPoint?.capacityKw ?? null;
  const sizedAnnual = annualHistory && proposedKw !== null ? { ...annualHistory, assetKw: proposedKw } : null;
  const latestResponse = simulateFlexibility(feeder, clock, config, 200, sizedAnnual, "limit");
  const row = latestResponse.rows[cursor];
  const netPeak = enabled ? latestResponse.netPeak : latestResponse.baselinePeak;
  const exceeded = proposedKw !== null && ((netPeak ?? 0) > proposedKw + 1e-6
    || ((enabled ? latestResponse.netExportPeak : latestResponse.baselineExportPeak) ?? 0) > proposedKw + 1e-6);
  const paidEnergyNow = row && enabled && proposedKw !== null
    ? Math.min(Math.abs(row.batteryKw), Math.max(0, Math.abs(row.baseline) - proposedKw)) * .5 : 0;
  const worstValues = alignWorstDay(worstDay, clock);
  const proposedBand = clock.map(() => proposedKw);
  const worstResponse = worstDay && sizedAnnual ? simulateWorstDay(feeder, worstDay, config, sizedAnnual) : null;
  const worstNet = worstDay && worstResponse ? alignWorstDay({ ...worstDay, samples: worstResponse.rows.flatMap(r => r ? [{ t: r.t, value: r.net }] : []) }, clock) : clock.map(() => null);
  const worstStillExceeds = worstResponse && proposedKw !== null && Math.max(worstResponse.netPeak ?? 0, worstResponse.netExportPeak ?? 0) > proposedKw;
  const referenceBand = clock.map(() => result.referenceImportKw);
  const profile = alignTimeProfile(annualHistory?.timeProfile, clock);
  const hasExport = result.rows.some(row => row !== null && row.baseline < 0) || worstValues.some(value => value !== null && value < 0) || profile.some(p=>p!==null && p.p50<0);
  const annual = result.annualCapacity;
  const loadingFor = (power: number) => power / latestResponse.importKw;
  return (
    <section className="section narrative-section story-first" id="feeder-story" aria-labelledby="story-title">
      <div className="section-heading">
        <div><p className="eyebrow">Figure 1 / One feeder over 24 hours</p><h2 id="story-title">Feeder loading through the day</h2>
          <p className="section-lede">Everyday demand versus the year’s highest-loading day. The proposed capacity changes with battery adoption.</p></div>
      </div>
      <div className="story-toolbar">
        <span className="asset-label">{feeder.substationName} / {feeder.name}<small>{windowLabel} · {formatStamp(clock[0])}–{formatStamp(new Date(Date.parse(clock.at(-1)!) + 1800000).toISOString())}</small></span>
        <span className="scenario-caption">{enabled ? "Batteries targeting proposed capacity" : "No battery response"}</span>
      </div>
      {longTerm ? <div className="long-term-panel"><p>Asset size = 12-month average of each day’s largest import or export flow.</p>{result.sizingAvailable ? <dl className="annual-sizing"><div><dt>Mean daily peak import</dt><dd>{formatKw(annual!.meanDailyMaxImportKw!)}</dd></div><div><dt>Mean daily peak export</dt><dd>{formatKw(annual!.meanDailyMaxExportKw!)}</dd></div><div><dt>Future asset size</dt><dd>{formatKw(result.importKw)}</dd></div></dl> : <p>Annual history unavailable for this feeder.</p>}<details><summary>Capacity assumptions</summary><p className="chart-note">{historyWindow ? `${formatDate(historyWindow.start)}–${formatDate(historyWindow.end)}. ` : ""}{annual ? `${annual.coveredDays} / ${annual.totalDays} days covered. ` : ""}Observed half-hour maxima; missing days excluded. Days need 50% bucket coverage, the year 90% covered days, and each month 75%. Sparse readings may miss peaks. The same thermal asset carries both directions; this is not an export permission. Batteries still need enough energy and reliable availability.</p></details></div> : null}
      <div className="story-grid">
        <div className="story-chart-panel">
          <div className="chart-key">{!enabled ? <><span><i className="key-line" />Latest 24h</span>{worstDay ? <span><i className="key-line wholesale" />Worst day · {formatDate(worstDay.date)}</span> : null}</> : null}{enabled && latestResponse.sizingAvailable ? <><span><i className="key-line response" />Latest 24h + batteries</span>{worstResponse ? <span><i className="key-line response" style={{background:"repeating-linear-gradient(to right, #1e7f66 0 7px, transparent 7px 12px)"}} />Worst day + batteries</span> : null}</> : null}{proposedKw !== null ? <span><i className="key-line" style={{background:"#b9423f"}} />Proposed capacity · {formatKw(proposedKw)}</span> : null}<span><i className="key-line assumed-limit" />Today’s assumed import limit · {capacityLabel(result.referenceImportKw)}</span>{showPercentiles ? <><span><i className="key-line wholesale" />Median / P50</span><span><i className="key-line" style={{background:"#ae7c2c"}} />P90</span><span><i className="key-line" style={{background:"#996388"}} />P99</span></> : null}</div>
          <div className="chart-card">
            <SeriesChart cursor={cursor} viewWidth={600} ariaLabel={enabled ? "Battery-adjusted latest 24 hours and highest-loading day, proposed capacity and today’s assumed limit" : "Original latest 24 hours and highest-loading day, with red shading above proposed capacity"} yAxis={{ label: "Feeder power (kW)", format: "number" }}
              bands={enabled ? [] : [
                { lower: worstValues.map(v => v === null || proposedKw === null ? null : proposedKw), upper: worstValues.map(v => v === null || proposedKw === null ? null : Math.max(proposedKw, v)), color: "rgba(185, 66, 63, 0.2)" },
                { lower: worstValues.map(v => !hasExport || v === null || proposedKw === null ? null : Math.min(-proposedKw, v)), upper: worstValues.map(v => !hasExport || v === null || proposedKw === null ? null : -proposedKw), color: "rgba(185, 66, 63, 0.2)" },
              ]}
              series={[
                { values: profile.map(p=>showPercentiles ? p?.p50??null : null), color: "#8d98a3", width: 2, dash: "6 5" },
                { values: profile.map(p=>showPercentiles ? p?.p90??null : null), color: "#ae7c2c", width: 1.5, dash: "8 4" },
                { values: profile.map(p=>showPercentiles ? p?.p99??null : null), color: "#996388", width: 1.5, dash: "2 4" },
                { values: referenceBand, color: "#8f99a3", width: 1.5, dash: "5 4" },
                { values: worstValues.map(v => enabled ? null : v), color: "#79818a", width: 2, dash: "7 5" },
                { values: result.rows.map((item) => enabled ? null : item?.baseline ?? null), color: "#46515e", width: 2 },
                { values: latestResponse.rows.map((item) => item && enabled && latestResponse.sizingAvailable ? item.net : null), color: "#1e7f66", width: 1.5 },
                { values: worstNet.map(v => enabled ? v : null), color: "#1e7f66", width: 3, dash: "7 5" },
                { values: proposedBand, color: "#b9423f", width: 1.5 },
                { values: proposedBand.map(v => hasExport && v !== null ? -v : null), color: "#b9423f", width: 1.5 },
              ]} />
            <div className="chart-axis" aria-hidden="true">{[0, .25, .5, .75, 1].map(fraction => <span key={fraction}>{formatTime(new Date(Date.parse(clock[0]) + fraction * clock.length * 1800000).toISOString())}</span>)}</div>
          </div>
          <TimeSlider clock={clock} cursor={cursor} onSeek={onSeek} label="Explore this day" />
          <p className="chart-note">{enabled ? "Dashed green: worst day with batteries targeting the proposed capacity. " : "Red shading: worst-day flow above proposed capacity. "}{enabled && worstResponse ? worstStillExceeds ? "Battery power or energy is insufficient on this day. " : "The simulated worst day stays within proposed capacity. " : ""}{sizing ? "Proposed capacity is the minimum feasible size across recorded annual intervals at the selected battery adoption." : "Annual sizing is unavailable for this feeder."}</p>
          <p className="chart-note">{worstDay ? `Worst day aligned by UK clock time · ${worstDay.samples.length}/${worstDay.expectedBuckets} readings · ${Math.round((annualCoverage??0)*100)}% annual day coverage. Gaps stay gaps.` : "Worst-day history unavailable."}</p>
          <details className="signal-details" onToggle={event => setShowPercentiles(event.currentTarget.open)}><summary>Historical percentiles</summary><p className="chart-note">P50 is the median; 90% of readings at each UK clock time are at or below P90, 99% at or below P99.</p></details>
          {result.sizingAvailable ? <details className="signal-details"><summary>Price signal</summary><div className="chart-key"><span><i className="key-line wholesale" />Wholesale</span><span><i className="key-line" />Wholesale + local adjustment</span></div><SeriesChart cursor={cursor} ariaLabel="Wholesale price and baseline local price signal in pounds per kWh" yAxis={{label:"Price (£/kWh)",format:"price"}} series={[{values:result.rows.map(item=>item?.wholesalePerKwh??null),color:"#8d98a3",width:1.5,dash:"5 5"},{values:result.rows.map(item=>item?item.wholesalePerKwh+item.signalPerKwh:null),color:"var(--ink)",width:2}]} /><p className="chart-note">This local price illustration is separate from the energy-only VPP tariff calculated from annual asset value below.</p></details> : null}
        </div>
        <aside className="story-readout" aria-label="Battery response at the selected time">
          <p className="eyebrow">At {formatTime(clock[cursor])}</p>
          <p className="readout-main">{row && result.sizingAvailable ? formatPct(loadingFor(row.baseline)) : "—"}<span>→</span><strong>{row && result.sizingAvailable ? formatPct(loadingFor(enabled ? row.net : row.baseline)) : "—"}</strong></p>
          <p className="readout-caption">latest 24h / proposed capacity</p>
          <dl className="story-stats">
            <div><dt>Battery response now</dt><dd>{row && result.sizingAvailable ? `${formatKw(enabled ? Math.abs(row.batteryKw) : 0)} ${enabled && row.batteryKw < 0 ? "charging" : "discharging"}` : "No complete reading"}</dd></div>
            <div><dt>VPP payment / half-hour</dt><dd>{row && sizingPoint ? `${((sizingPoint.tariffGbpPerKwh ?? 0) * paidEnergyNow * 100).toFixed(2)}p` : "—"}</dd></div>
            {!enabled ? <div><dt>Worst day at this time</dt><dd>{worstValues[cursor] === null ? "—" : formatKw(worstValues[cursor])}</dd></div> : null}
            {enabled && worstResponse ? <div><dt>Worst day with batteries</dt><dd>{worstNet[cursor] === null ? "—" : formatKw(worstNet[cursor])}<small>Against proposed capacity.</small></dd></div> : null}
            <div><dt>Proposed capacity</dt><dd>{proposedKw === null ? "—" : capacityLabel(proposedKw)}</dd></div>
            {!enabled && worstDay ? <div><dt>Worst observed day’s peak</dt><dd>{formatPct(worstDay.peakLoading)}<small>of today’s assumed directional limit</small></dd></div> : null}
            <div><dt>Latest 24h peak import</dt><dd>{netPeak === null ? "—" : formatKw(netPeak)} <small>vs {latestResponse.baselinePeak === null ? "—" : formatKw(latestResponse.baselinePeak)} original</small></dd></div>
            {sizingPoint && sizing ? <div><dt>Annual capacity reduction</dt><dd>{formatKw(sizing.baselinePeakKw - sizingPoint.capacityKw)}<small>Relative to the observed annual peak.</small></dd></div> : null}
          </dl>
          <p className={`constraint-status ${exceeded ? "binding" : "clear"}`}>{proposedKw === null ? "Annual sizing unavailable" : exceeded ? "Proposed capacity exceeded" : "Within proposed capacity"}<small>{proposedKw === null ? "No future size or battery response estimated." : exceeded ? "More capacity or flexibility required on this day." : "Recorded readings only."}</small></p>
        </aside>
      </div>
      <div className="battery-controls">
        <label htmlFor="homes">Households with a battery <strong>{batteryShare}%</strong></label>
        <input id="homes" type="range" min="0" max="100" step="1" value={batteryShare} onChange={(event) => onBatteryShare(Number(event.target.value))} />
        <p>{config.households} / {assumedHouseholdsPerFeeder} assumed homes per feeder · {config.powerPerHomeKw} kW / {config.energyPerHomeKwh} kWh · starts full</p>
      </div>
      {result.sizingAvailable ? <div className="supporting-bars">
        <MiniBar title="Load factor" before={result.baselineLoadFactor ?? 0} after={enabled ? result.netLoadFactor ?? 0 : result.baselineLoadFactor ?? 0} label="Average ÷ peak demand." />
        <div className="capacity-result"><p className="eyebrow">{enabled ? `Annual sizing at ${batteryShare}% adoption` : "Annual sizing without batteries"}</p><p><strong>{proposedKw === null ? "—" : capacityLabel(proposedKw)}</strong><span>{sizingPoint ? `${sizingPoint.tariffGbpPerKwh === null ? "No tariff" : `${(sizingPoint.tariffGbpPerKwh * 100).toLocaleString("en-GB", { maximumFractionDigits: 3 })}p/kWh`} · ${money(sizingPoint.annualPaymentGbp)}/year VPP payment` : "Annual sizing unavailable"}</span></p><small>Assumed £{parameters.gbpPerKva}/kVA asset cost.</small></div>
      </div> : null}
      <div className="duration-figure" aria-labelledby="duration-title"><p className="eyebrow">Figure 2 / Capacity reserved for peaks</p><h2 id="duration-title">How often do we need this capacity?</h2><p className="chart-note">{feeder.substationName} / {feeder.name} · {historyWindow ? `${formatDate(historyWindow.start)}–${formatDate(historyWindow.end)}` : "Annual history unavailable"}</p><CapacityDurationChart annual={annualHistory} currentKw={result.referenceImportKw} scenario={scenario} proposedKw={proposedKw} aboveHours={sizingPoint?.constrainedHours ?? null} /></div>
    </section>
  );
}

export function TimeSlider({ clock, cursor, onSeek, label }: { clock: string[]; cursor: number; onSeek: (index: number) => void; label: string }) {
  return <div className="time-control"><div><label>{label}</label><strong>{formatTime(clock[cursor])}</strong></div><input type="range" aria-label={label} min="0" max={clock.length - 1} step="1" value={cursor} onChange={(event) => onSeek(Number(event.target.value))} /></div>;
}

function MiniBar({ title, before, after, label }: { title: string; before: number; after: number; label: string }) {
  return <div className="mini-comparison"><p className="eyebrow">{title}</p><div><span>Without</span><i style={{ width: `${Math.min(100, Math.max(0, before * 100))}%` }} /><strong>{formatPct(before)}</strong></div><div><span>With</span><i className="response" style={{ width: `${Math.min(100, Math.max(0, after * 100))}%` }} /><strong>{formatPct(after)}</strong></div><small>{label}</small></div>;
}
