"use client";

import { useEffect, useMemo, useState } from "react";
import { SeriesChart } from "@/components/charts";
import { PriceMap } from "@/components/price-map";
import {
  constraintSignal,
  defaultScenario,
  importLimit,
  signalCap,
  signalColor,
  type Scenario,
  type Signal,
} from "@/lib/constraint";
import { formatStamp, formatTime } from "@/lib/format";
import { substationsOf } from "@/lib/group";
import { streetLayout } from "@/lib/street-trace";
import type { Feeder, Snapshot } from "@/lib/types";

const mean = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
const money = (value: number | null) =>
  value === null
    ? "Unavailable"
    : `${value < 0 ? "−" : value > 0 ? "+" : ""}£${Math.abs(value).toFixed(3)}`;

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(defaultScenario);
  const [substationId, setSubstationId] = useState<string | null>(null);
  const [feederId, setFeederId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layer, setLayer] = useState<"pressure" | "price">("pressure");
  const [combined, setCombined] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ lat: number; lon: number; token: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/snapshot")
      .then((response) => {
        if (!response.ok) throw new Error("snapshot unavailable");
        return response.json();
      })
      .then((data) => {
        if (active) setSnapshot(data as Snapshot);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const feeders = useMemo(() => snapshot?.feeders ?? [], [snapshot]);
  const groups = useMemo(() => substationsOf(feeders), [feeders]);
  const clock = useMemo(() => {
    if (!snapshot) return [];
    const start = Date.parse(snapshot.window.start);
    const end = Date.parse(snapshot.window.end);
    return Array.from(
      { length: Math.round((end - start) / 1_800_000) },
      (_, offset) => new Date(start + offset * 1_800_000).toISOString(),
    );
  }, [snapshot]);
  const layout = useMemo(
    () => snapshot?.streets ?? streetLayout(feeders),
    [snapshot, feeders],
  );
  const observations = useMemo(
    () => new Map(feeders.map((feeder) => [feeder.id, new Map(feeder.samples.map((sample) => [sample.t, sample]))])),
    [feeders],
  );
  const signals = useMemo(
    () =>
      new Map(
        feeders.map((feeder) => [
          feeder.id,
          clock.map((time) => {
            const sample = observations.get(feeder.id)?.get(time);
            return sample
              ? constraintSignal(sample.pKw, importLimit(feeder, scenario), scenario)
              : null;
          }),
        ]),
      ),
    [feeders, clock, observations, scenario],
  );

  useEffect(() => {
    if (!playing || !clock.length) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % clock.length), 3000);
    return () => window.clearInterval(timer);
  }, [playing, clock.length]);

  const group = groups.find((item) => item.id === substationId);
  const feeder = group?.feeders.find((item) => item.id === feederId);
  const scope = feeder ? [feeder] : group ? group.feeders : feeders;
  const now = (item: Feeder): Signal | null => signals.get(item.id)?.[index] ?? null;
  const available = scope.filter((item) => now(item) !== null).length;
  const priced = scope.filter((item) => now(item)?.price !== null && now(item) !== null).length;
  const affected = scope.filter((item) => now(item)?.constrained === true).length;
  const constrainedHours = scope.reduce(
    (sum, item) => sum + (signals.get(item.id) ?? []).filter((signal) => signal?.constrained === true).length * 0.5,
    0,
  );
  const extremeScope = group?.feeders ?? feeders;
  const premium = extremeScope
    .filter((item) => (now(item)?.price ?? 0) > 0)
    .sort((a, b) => (now(b)?.price ?? 0) - (now(a)?.price ?? 0))[0];
  const discount = extremeScope
    .filter((item) => (now(item)?.price ?? 0) < 0)
    .sort((a, b) => (now(a)?.price ?? 0) - (now(b)?.price ?? 0))[0];
  const cap = signalCap(scenario.importCost, scenario);
  const mapColor = (signal: Signal | null) =>
    signalColor(
      signal,
      layer,
      Math.max(cap, scenario.exportCost === null ? 0 : signalCap(scenario.exportCost, scenario)),
    );

  function select(nextSubstationId: string, nextFeederId?: string, move = false) {
    setSubstationId(nextSubstationId);
    setFeederId(nextFeederId ?? null);
    const nextGroup = groups.find((item) => item.id === nextSubstationId);
    if (move && nextGroup) {
      setFocus({ lat: nextGroup.lat, lon: nextGroup.lon, token: Date.now() });
    }
  }
  function clear() {
    setSubstationId(null);
    setFeederId(null);
  }

  const scopeLabel = feeder
    ? `${group?.name} · ${feeder.name}`
    : group
      ? `${group.name} · downstream feeders`
      : "Oxford network";
  const pressureSeries = clock.map((_, cursor) => {
    if (feeder) return signals.get(feeder.id)?.[cursor]?.loading ?? null;
    const readings = scope.map((item) => signals.get(item.id)?.[cursor] ?? null);
    return readings.some((reading) => reading !== null)
      ? readings.filter((reading) => reading?.constrained === true).length
      : null;
  });
  const priceSeries = clock.map((_, cursor) =>
    mean(scope.map((item) => signals.get(item.id)?.[cursor]?.price ?? null)),
  );
  const wholesale = clock.map((time) =>
    mean(scope.map((item) => observations.get(item.id)?.get(time)?.wholesale ?? null)),
  );
  const combinedSeries = clock.map((time, cursor) =>
    mean(
      scope.map((item) => {
        const signal = signals.get(item.id)?.[cursor];
        const wholesalePrice = observations.get(item.id)?.get(time)?.wholesale;
        return signal?.price !== null && signal?.price !== undefined && wholesalePrice !== undefined
          ? signal.price + wholesalePrice / 1000
          : null;
      }),
    ),
  );
  const points = groups.map((item) => {
    const values = item.feeders.map(now);
    const strongest = values
      .filter((signal): signal is Signal => signal !== null && signal.loading !== null)
      .sort((a, b) =>
        layer === "price"
          ? Math.abs(b.price ?? 0) - Math.abs(a.price ?? 0)
          : (b.loading ?? 0) - (a.loading ?? 0),
      )[0];
    return {
      id: item.id,
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      color: mapColor(strongest ?? values.find((signal) => signal !== null) ?? null),
      selected: item.id === substationId,
    };
  });
  const lines = layout.traces.map((trace) => ({
    ...trace,
    color: mapColor(signals.get(trace.feederId)?.[index] ?? null),
    selected: trace.feederId === feederId,
  }));
  const axis = (
    <div className="chart-axis" aria-hidden="true">
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
        <span key={fraction}>
          {clock.length
            ? formatTime(clock[Math.min(clock.length - 1, Math.round(fraction * (clock.length - 1)))])
            : ""}
        </span>
      ))}
    </div>
  );

  if (error) return <main className="status"><h1>Snapshot unavailable</h1><p>Please reload to try again.</p></main>;
  if (!snapshot) return <main className="status"><h1>Loading Oxford…</h1></main>;

  return (
    <main className="story">
      <section className="intro section">
        <div className="intro-kicker">
          <p className="eyebrow">Streetprice · experimental network signal</p>
          <a className="social-link" href="https://x.com/dootonline" target="_blank" rel="noreferrer" aria-label="Doot Online on X">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          </a>
        </div>
        <h1>Price the constraint. Not the average.</h1>
        <p className="intro-summary">Explore where a network price signal would rise as Oxford’s feeders approach their limits. {groups.length} substations · {feeders.length} LV feeders.</p>
        <p className="scenario-notice">{snapshot.source === "fixture" ? "Synthetic example" : "Historical replay"} · {formatStamp(snapshot.window.start)}–{formatStamp(snapshot.window.end)} · Assumed limits and costs. Observed load stands in for a forecast; this is not a live tariff.</p>
      </section>

      <section className="hero section">
        <div className="map-column">
          <div className="layer-control" role="group" aria-label="Map layer">
            <button aria-pressed={layer === "pressure"} onClick={() => setLayer("pressure")}>Constraint pressure</button>
            <button aria-pressed={layer === "price"} onClick={() => setLayer("price")}>Price signal</button>
          </div>
          <div className="map-card">
            <PriceMap points={points} lines={lines} stubs={layout.stubs} focus={focus} ariaLabel={`Oxford LV feeders coloured by ${layer === "pressure" ? "constraint pressure" : "network price signal"}. Illustrative street traces are not mapped cables.`} onSelectSubstation={(id) => select(id)} onSelectFeeder={(sid, fid) => select(sid, fid)} onClearSelection={clear} />
            <div className="map-legend constraint-legend"><span className="import-key">● Import</span><span className="export-key">● Export</span><span className="neutral-key">● Neutral</span><span className="unknown-key">● Unknown limit</span><span className="missing-key">● Missing</span></div>
          </div>
          <p className="map-caption">Stronger colour = {layer === "pressure" ? "closer to the assumed limit" : "larger signal"}. Substation dots show the strongest known feeder; street traces are illustrative, not cable routes.</p>
        </div>

        <section className="comparison-panel">
          <div className="section-heading"><div><p className="eyebrow">{feeder ? "LV feeder" : group ? "Substation" : "Whole network"}</p><h2>{scopeLabel}</h2><p className="scope-label">{available}/{scope.length} load readings · {priced}/{scope.length} priced at {clock[index] ? formatTime(clock[index]) : "–"}</p></div></div>
          <div className="chart-card">
            <p className="chart-label">{feeder ? "Loading against the applicable limit" : "Feeders above their applicable limit"}</p>
            <SeriesChart cursor={index} ariaLabel="Constraint pressure over the replay window" yAxis={{ label: feeder ? "Loading (%)" : "Affected feeders", format: "number" }} series={[
              { values: pressureSeries.map((value) => value === null ? null : feeder ? value * 100 : value), color: "#d43f29", width: 2.5 },
              ...(feeder ? [{ values: clock.map(() => 100), color: "#939ba5", width: 1, dash: "5 5" }, { values: clock.map(() => scenario.rampStart * 100), color: "#d4a28b", width: 1, dash: "3 5" }] : []),
            ]} />
            {axis}
          </div>
          <div className="chart-card">
            <p className="chart-label">{feeder ? "Network price signal" : "Available-sample mean network signal"}</p>
            <SeriesChart cursor={index} ariaLabel="Network signal and optional wholesale comparison" yAxis={{ label: "£/kWh", format: "price" }} series={[
              { values: priceSeries, color: "#171a20", width: 2.5 },
              ...(combined ? [{ values: wholesale.map((value) => value === null ? null : value / 1000), color: "#939ba5", width: 1.5, dash: "5 5" }, { values: combinedSeries, color: "#3e6ae1", width: 2 }] : []),
            ]} />
            {axis}
            <label className="comparison-toggle"><input type="checkbox" checked={combined} onChange={(event) => setCombined(event.target.checked)} /> Show wholesale (grey) + illustrative combined price (blue)</label>
          </div>
        </section>

        <dl className="hero-metrics constraint-metrics">
          <Metric label="Affected feeders now" value={`${affected}`} detail="Above known or assumed limit" />
          <Metric label="Constrained feeder-hours" value={constrainedHours.toFixed(1)} detail="Observed in this replay window" />
          <Metric label="Max import surcharge" value={premium ? money(now(premium)?.price ?? null) : money(0)} tone="premium" detail={premium?.substationName ?? "No import surcharge now"} onClick={premium ? () => select(premium.substationId, premium.id, true) : undefined} />
          <Metric label="Max export incentive" value={scenario.exportKw === null || scenario.exportCost === null ? "Unavailable" : discount ? money(now(discount)?.price ?? null) : money(0)} tone="discount" detail={discount?.substationName ?? "Reverse-flow assumptions required"} onClick={discount ? () => select(discount.substationId, discount.id, true) : undefined} />
        </dl>

        <div className="map-follow">
          <div className="time-control"><div><button className="play" aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button><span>30 min every 3 s</span><strong>{clock[index] ? formatStamp(clock[index]) : "–"}</strong></div><input type="range" aria-label="Time of day" min={0} max={Math.max(0, clock.length - 1)} value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} /></div>
          <div className="substation-search"><label><span>Explore a substation</span><input aria-label="Search substations" placeholder="Search Oxford" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="substation-results"><button className={!group ? "location on" : "location"} onClick={clear}>Whole network</button>{groups.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).map((item) => <button key={item.id} className={group?.id === item.id ? "location on" : "location"} onClick={() => select(item.id, undefined, true)}>{item.name}</button>)}</div></div>
        </div>
      </section>

      {group ? <section className="section feeder-section"><h2>{group.name}</h2><div className="location-switcher"><button className={!feeder ? "location on" : "location"} onClick={() => setFeederId(null)}>All downstream feeders</button>{group.feeders.map((item) => <button className={feeder?.id === item.id ? "location on" : "location"} key={item.id} onClick={() => select(group.id, item.id)}>{item.name}</button>)}</div>{feeder ? <p className="scenario-notice">Import limit: {importLimit(feeder, scenario).toFixed(1)} kW ({feeder.ratingSource.startsWith("assumed") ? "scenario assumption" : "asset rating × assumed power factor"}). Export limit: {scenario.exportKw ?? "unknown"}{scenario.exportKw !== null ? " kW (assumed)" : ""}. Missing readings and unknown export signals remain gaps, not zero.</p> : null}</section> : null}

      <section className="section disclosures">
        <details open><summary>Scenario controls · all costs below are assumptions</summary><div className="scenario-controls">
          <NumberInput label="Ramp starts at (% of limit)" value={scenario.rampStart * 100} min={0} max={99} onChange={(value) => setScenario({ ...scenario, rampStart: value / 100 })} />
          <NumberInput label="Fallback import fuse (A)" value={scenario.importAmps} min={1} max={2000} onChange={(value) => setScenario({ ...scenario, importAmps: value })} />
          <NumberInput label="Power factor" value={scenario.powerFactor} min={0.1} max={1} step={0.05} onChange={(value) => setScenario({ ...scenario, powerFactor: value })} />
          <NumberInput label="Import reinforcement (£/kVA)" value={scenario.importCost} min={0} max={100000} onChange={(value) => setScenario({ ...scenario, importCost: value })} />
          <NumberInput label="Expected binding hours/year" value={scenario.bindingHours} min={0.5} max={8760} step={0.5} onChange={(value) => setScenario({ ...scenario, bindingHours: value })} />
          <NumberInput label="Asset life (years)" value={scenario.lifeYears} min={1} max={100} onChange={(value) => setScenario({ ...scenario, lifeYears: value })} />
          <NumberInput label="Discount rate (%)" value={scenario.discountRate * 100} min={0} max={50} step={0.5} onChange={(value) => setScenario({ ...scenario, discountRate: value / 100 })} />
        </div><label className="comparison-toggle"><input type="checkbox" checked={scenario.exportKw !== null} onChange={(event) => setScenario({ ...scenario, exportKw: event.target.checked ? 100 : null, exportCost: event.target.checked ? 40 : null })} /> Enable an assumed reverse-flow limit and cost (not verified)</label>{scenario.exportKw !== null ? <div className="scenario-controls"><NumberInput label="Reverse-flow limit (kW)" value={scenario.exportKw} min={1} max={2000} onChange={(value) => setScenario({ ...scenario, exportKw: value })} /><NumberInput label="Reverse reinforcement (£/kVA)" value={scenario.exportCost ?? 0} min={0} max={100000} onChange={(value) => setScenario({ ...scenario, exportCost: value })} /></div> : null}
        <p>The import signal rises linearly from zero at {(scenario.rampStart * 100).toFixed(0)}% loading to {money(cap)}/kWh at 100%. It stays capped above the limit. Export uses its own limit and cost; ordinary low demand earns no network incentive.</p><p>Changes update this replay only, not the historical day selection. Expected annual binding hours are an input, not an extrapolation from this day.</p></details>
        <details><summary>Historical coverage and day selection</summary><p>{snapshot.constraintModel?.search.status ?? "Annual search has not been completed. This is the existing one-day historical replay, not the most constrained day of the year."}</p><p>Day selection requires ≥90% complete half-hours per feeder and a common cohort eligible on ≥90% of searched London-calendar days. Rank by exceedance half-hours, then affected feeders, exceedance energy, and earliest date. DST days use their actual length.</p><button className="secondary-action" type="button" disabled title="Requires a completed half-hour historical scan">Re-rank day after a completed scan</button></details>
        <details><summary>Model and provenance</summary><p>Network signal = capped import ramp − capped reverse-flow ramp. Cap (£/kWh) = reinforcement cost (£/kVA) × capital recovery factor ÷ power factor ÷ expected binding hours. Fixed revenue-recovery charges and battery response are not modelled. No avoided-capex or upgrade-deferral claim is made.</p><p>All current feeder limits are assumptions unless explicitly identified as asset ratings. SSEN’s published generic connection costs are not asset-specific incremental reinforcement costs. <a href="https://www.ssen.co.uk/our-services/tools-and-maps/near-real-time-data-access-nerda-portal/">SSEN NeRDA</a> provides the historical observations. Export capability cannot be inferred from an import fuse.</p></details>
      </section>
      <footer className="footer section"><p>SSEN NeRDA observations · BMRS data © Elexon Limited · illustrative street lines © OpenStreetMap contributors.</p><p>Experimental scenario, not an SSEN tariff, operational instruction, or forecast.</p></footer>
    </main>
  );
}

function NumberInput({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max) onChange(next); }} /></label>;
}

function Metric({ label, value, detail, tone, onClick }: { label: string; value: string; detail: string; tone?: string; onClick?: () => void }) {
  return <div className={`metric ${tone ?? ""}`}><dt>{label}</dt><dd>{value}</dd>{onClick ? <button className="metric-detail metric-link" onClick={onClick}>{detail}</button> : <p className="metric-detail">{detail}</p>}</div>;
}
