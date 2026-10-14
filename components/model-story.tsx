import { SeriesChart } from "./charts";
import { formatDate, formatKw, formatStamp, formatTime } from "@/lib/format";
import type { BatteryScenario, FlexResult, ViewScenario } from "@/lib/flexibility";
import type { AnnualCapacity, Feeder, WorstDay } from "@/lib/types";
import type { FeederSizingCurve } from "@/lib/sizing-equilibrium";
import { alignWorstDay, simulateWorstDay } from "@/lib/worst-day";

export function StoryHero({ feeder, annual, sizing, worstDay, result, config, clock, cursor, scenario }: {
  feeder: Feeder;
  annual?: AnnualCapacity;
  sizing?: FeederSizingCurve;
  worstDay?: WorstDay | null;
  result: FlexResult;
  config: BatteryScenario;
  clock: string[];
  cursor: number;
  scenario: ViewScenario;
}) {
  const proposedKw = scenario === "battery" ? sizing?.points[config.households]?.capacityKw ?? null : null;
  const batteryReady = scenario === "battery" && annual?.status === "ready" && proposedKw !== null;
  const worstBaseline = alignWorstDay(worstDay, clock);
  const worstResponse = batteryReady && worstDay
    ? simulateWorstDay(feeder, worstDay, config, { ...annual, assetKw: proposedKw }) : null;
  const worstBattery = worstDay && worstResponse
    ? alignWorstDay({ ...worstDay, samples: worstResponse.rows.flatMap(row => row ? [{ t: row.t, value: row.net }] : []) }, clock)
    : clock.map(() => null);
  const proposed = clock.map(() => proposedKw);
  const assumed = clock.map(() => result.referenceImportKw);

  return <section className="section figure-section" id="figure-1" aria-labelledby="figure-title">
    <p className="eyebrow">Figure 1 / One feeder over 24 hours</p>
    <h2 id="figure-title">Feeder loading through the day</h2>
    <p className="section-lede">Latest 24 hours beside the feeder’s highest-loading day of the year.</p>
    <div className="figure-heading"><strong>{feeder.substationName} / {feeder.name}</strong><span>{formatStamp(clock[0])}–{formatStamp(new Date(Date.parse(clock.at(-1)!) + 1800000).toISOString())}</span></div>
    <div className="chart-key">
      {batteryReady ? <>
        <span><i className="key-line battery" />Latest 24h + batteries</span>
        {worstResponse ? <span><i className="key-line battery-dashed" />Worst day + batteries</span> : null}
      </> : <>
        <span><i className="key-line latest" />Latest 24h</span>
        {worstDay ? <span><i className="key-line worst" />Worst day · {formatDate(worstDay.date)}</span> : null}
      </>}
      {proposedKw !== null ? <span><i className="key-line proposed" />Proposed capacity · {formatKw(proposedKw)}</span> : null}
      <span><i className="key-line assumed-limit" />Today’s assumed import limit · {formatKw(result.referenceImportKw)}</span>
    </div>
    <div className="chart-card">
      <SeriesChart cursor={cursor} viewWidth={600} ariaLabel={batteryReady
        ? "Battery-adjusted feeder power in kilowatts, with proposed capacity and today's assumed import limit"
        : "Observed feeder power in kilowatts, with today's assumed import limit"}
        yAxis={{ label: "Feeder power (kW)", format: "number" }}
        series={[
          { values: assumed, color: "#8f99a3", width: 1.5, dash: "5 4" },
          { values: worstBaseline.map(value => batteryReady ? null : value), color: "#79818a", width: 2, dash: "7 5" },
          { values: result.rows.map(row => batteryReady ? null : row?.baseline ?? null), color: "#46515e", width: 2 },
          { values: result.rows.map(row => batteryReady ? row?.net ?? null : null), color: "#1e7f66", width: 2 },
          { values: worstBattery, color: "#1e7f66", width: 2.5, dash: "7 5" },
          { values: proposed, color: "#b9423f", width: 1.5 },
        ]} />
      <div className="chart-axis" aria-hidden="true">{[0, .25, .5, .75, 1].map(fraction =>
        <span key={fraction}>{formatTime(new Date(Date.parse(clock[0]) + fraction * clock.length * 1800000).toISOString())}</span>)}</div>
    </div>
    <p className="figure-note">{batteryReady
      ? "Green shows simulated battery response targeting the proposed capacity."
      : scenario === "battery" ? "Annual battery sizing is unavailable for this feeder; original flow is shown."
        : "The two traces show observed flow without battery response."} The grey dashed line is today’s assumed limit, not a measured feeder rating.</p>
  </section>;
}

export function TimeSlider({ clock, cursor, onSeek, label }: { clock: string[]; cursor: number; onSeek: (index: number) => void; label: string }) {
  return <div className="time-control"><div><label htmlFor="time-slider">{label}</label><strong>{formatTime(clock[cursor])}</strong></div>
    <input id="time-slider" type="range" aria-label={label} min="0" max={clock.length - 1} step="1" value={cursor}
      onChange={event => onSeek(Number(event.target.value))} /></div>;
}
