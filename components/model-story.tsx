import { SeriesChart } from "./charts";
import { formatDate, formatKw, formatStamp, formatTime } from "@/lib/format";
import type { BatteryScenario, FlexResult, ViewScenario } from "@/lib/flexibility";
import type { AnnualCapacity, Feeder, WorstDay } from "@/lib/types";
import { alignWorstDay, simulateWorstDay } from "@/lib/worst-day";
import { localPriceSeries } from "@/lib/local-price";
import { defaultScenario } from "@/lib/constraint";

export function StoryHero({ feeder, annual, proposedCapacityKw, localTariffGbpPerKwh, worstDay, result, config, clock, cursor, scenario }: {
  feeder: Feeder;
  annual?: AnnualCapacity;
  proposedCapacityKw: number | null;
  localTariffGbpPerKwh: number | null;
  worstDay?: WorstDay | null;
  result: FlexResult;
  config: BatteryScenario;
  clock: string[];
  cursor: number;
  scenario: ViewScenario;
}) {
  const proposedKw = scenario === "battery" ? proposedCapacityKw : null;
  const batteryReady = scenario === "battery" && annual?.status === "ready" && proposedKw !== null;
  const worstBaseline = alignWorstDay(worstDay, clock);
  const worstResponse = batteryReady && worstDay
    ? simulateWorstDay(feeder, worstDay, config, { ...annual, assetKw: proposedKw }) : null;
  const worstBattery = worstDay && worstResponse
    ? alignWorstDay({ ...worstDay, samples: worstResponse.rows.flatMap(row => row ? [{ t: row.t, value: row.net }] : []) }, clock)
    : clock.map(() => null);
  const proposed = clock.map(() => proposedKw);
  const assumed = clock.map(() => result.referenceImportKw);
  const wholesale = result.rows.map(row => row?.wholesalePerKwh ?? null);
  const priceImportKw = batteryReady ? proposedKw : result.referenceImportKw;
  const priceExportKw = batteryReady ? proposedKw : defaultScenario.exportKw!;
  const latestLocal = localPriceSeries(wholesale, result.rows.map(row => row?.baseline ?? null), priceImportKw, priceExportKw, localTariffGbpPerKwh);
  const worstLocal = localPriceSeries(wholesale, worstBaseline, priceImportKw, priceExportKw, localTariffGbpPerKwh);
  const timeTicks = [...new Set([0, .25, .5, .75].map(fraction => Math.round(fraction * clock.length)).concat(clock.length - 1))]
    .map(index => ({ index, label: formatTime(clock[index]) }));

  return <section className="section figure-section" id="figure-1" aria-labelledby="figure-title">
    <p className="eyebrow">Figure 1 / One feeder over 24 hours</p>
    <h2 id="figure-title">Feeder loading through the day</h2>
    <p className="section-lede">Latest 24 hours beside the feeder’s highest-loading day of the year.</p>
    <div className="figure-heading"><strong>{feeder.substationName} / {feeder.name}</strong><span>{formatStamp(clock[0])}–{formatStamp(new Date(Date.parse(clock.at(-1)!) + 1800000).toISOString())}</span></div>
    <div className="figure-charts">
    <div className="figure-chart loading-panel">
    <h3>Loading</h3>
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
      <SeriesChart cursor={cursor} viewWidth={480} ariaLabel={batteryReady
        ? "Battery-adjusted feeder power in kilowatts, with proposed capacity and today's assumed import limit"
        : "Observed feeder power in kilowatts, with today's assumed import limit"}
        yAxis={{ label: "Feeder power (kW)", format: "number" }}
        xAxis={timeTicks}
        series={[
          { values: assumed, color: "#8f99a3", width: 1.5, dash: "5 4" },
          { values: worstBaseline.map(value => batteryReady ? null : value), color: "#79818a", width: 2, dash: "7 5" },
          { values: result.rows.map(row => batteryReady ? null : row?.baseline ?? null), color: "#46515e", width: 2 },
          { values: result.rows.map(row => batteryReady ? row?.net ?? null : null), color: "#1e7f66", width: 2 },
          { values: worstBattery, color: "#1e7f66", width: 2.5, dash: "7 5" },
          { values: proposed, color: "#b9423f", width: 1.5 },
        ]} />
    </div>
    </div>
    <div className="figure-chart price-panel">
      <h3>Local + wholesale price</h3>
      <div className="chart-key">
        <span><i className="key-line wholesale-price" />Wholesale</span>
        <span><i className="key-line latest" />Latest 24h local</span>
        {worstDay ? <span><i className="key-line worst-price" />Worst-day local</span> : null}
      </div>
      <div className="chart-card">
        <SeriesChart cursor={cursor} viewWidth={480} ariaLabel="Wholesale and local electricity prices; worst-day demand uses the same wholesale curve"
          yAxis={{ label: "Price (p/kWh)", format: "pence" }} xAxis={timeTicks} series={[
            { values: wholesale, color: "#b5bcc4", width: 3 },
            { values: latestLocal, color: "#46515e", width: 1.5 },
            { values: worstLocal, color: "#b9423f", width: 2, dash: "7 5" },
          ]} />
      </div>
    </div>
    </div>
    <p className="figure-note">{batteryReady
      ? "Green shows simulated battery response targeting the proposed capacity."
      : scenario === "battery" ? "Annual battery sizing is unavailable for this feeder; original flow is shown."
        : "The two traces show observed flow without battery response."} The grey dashed line is today’s assumed limit, not a measured feeder rating.</p>
    <p className="figure-note">{localTariffGbpPerKwh === null ? "Local tariff unavailable for this feeder. " : "Local prices add the energy-only VPP tariff when demand exceeds capacity, before battery response. "}The dashed price trace applies worst-day demand to the same wholesale curve.</p>
  </section>;
}

export function TimeSlider({ clock, cursor, onSeek, label }: { clock: string[]; cursor: number; onSeek: (index: number) => void; label: string }) {
  return <div className="time-control"><div><label htmlFor="time-slider">{label}</label><strong>{formatTime(clock[cursor])}</strong></div>
    <input id="time-slider" type="range" aria-label={label} min="0" max={clock.length - 1} step="1" value={cursor}
      onChange={event => onSeek(Number(event.target.value))} /></div>;
}
