"use client";

import { useEffect, useMemo, useState } from "react";
import { PriceMap } from "@/components/price-map";
import { SeriesChart } from "@/components/charts";
import { StoryHero, TimeSlider } from "@/components/model-story";
import { SizingEconomics } from "@/components/sizing-economics";
import { ScenarioControls } from "@/components/scenario-controls";
import { batteryDefaults, batteryHomesForShare, simulateFlexibility, type ViewScenario } from "@/lib/flexibility";
import { capacityColor } from "@/lib/color";
import { formatPct, formatStamp } from "@/lib/format";
import { substationsOf } from "@/lib/group";
import { streetLayout } from "@/lib/street-trace";
import { monitoredPowerAt, transformerFor } from "@/lib/transformer";
import type { Feeder, Snapshot } from "@/lib/types";
import { openingFeeder } from "@/lib/worst-day";

function clockOf(snapshot: Snapshot) {
  const start = Date.parse(snapshot.window.start), end = Date.parse(snapshot.window.end);
  return Array.from({ length: Math.round((end - start) / 1800000) }, (_, index) => new Date(start + index * 1800000).toISOString());
}

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [feederId, setFeederId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [scenario, setScenario] = useState<ViewScenario>("battery");
  const enabled = scenario !== "none";
  const [batteryShare, setBatteryShare] = useState(33);
  const homes = batteryHomesForShare(batteryShare);
  const [mapMode, setMapMode] = useState<"peak" | "time">("peak");
  const [mapLayer, setMapLayer] = useState<"loading" | "value">("loading");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ lat: number; lon: number; token: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/snapshot", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Snapshot unavailable");
      return await response.json() as Snapshot;
    }).then((data) => {
      if (controller.signal.aborted) return;
      setSnapshot(data);
      const first = openingFeeder(data.feeders, data.annualCapacity, data.ratingAssumptionAmps, clockOf(data));
      setFeederId(first.id);
      const peak = first.samples.reduce((best, sample) => sample.pKw > best.pKw ? sample : best, first.samples[0]);
      setCursor(Math.max(0, clockOf(data).indexOf(peak?.t)));
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  const feeders = useMemo(() => snapshot?.feeders ?? [], [snapshot]);
  const groups = useMemo(() => substationsOf(feeders), [feeders]);
  const clock = useMemo(() => snapshot ? clockOf(snapshot) : [], [snapshot]);
  const config = useMemo(() => ({ ...batteryDefaults, households: homes }), [homes]);
  const simulations = useMemo(() => new Map(feeders.map((feeder) => [feeder.id, simulateFlexibility(feeder, clock, config, snapshot?.ratingAssumptionAmps, scenario === "long-term" ? snapshot?.annualCapacity?.feeders[feeder.id] ?? null : undefined)])), [feeders, clock, config, snapshot?.ratingAssumptionAmps, snapshot?.annualCapacity, scenario]);
  const layout = useMemo(() => snapshot?.streets ?? streetLayout(feeders), [snapshot, feeders]);
  const feeder = feeders.find((item) => item.id === feederId) ?? feeders[0];
  const group = groups.find((item) => item.id === feeder?.substationId);
  const result = simulations.get(feeder?.id);
  if (error) return <main className="status"><p className="brand">Streetprice</p><h1>The Oxford snapshot could not be loaded.</h1><p>Please reload to try again.</p></main>;
  if (!snapshot || !feeder || !result || !group || !clock.length) return <main className="status"><p className="brand">Streetprice</p><h1>Loading the Oxford model…</h1></main>;
  function selectFeeder(id: string, moveMap = false) {
    const item = feeders.find((candidate) => candidate.id === id);
    if (!item) return;
    setFeederId(id);
    const peak = item.samples.reduce((best, sample) => sample.pKw > best.pKw ? sample : best, item.samples[0]);
    if (peak) setCursor(Math.max(0, clock.indexOf(peak.t)));
    if (moveMap) setFocus({ lat: item.lat, lon: item.lon, token: Date.now() });
  }
  function defaultFeeder(items: Feeder[]) {
    return openingFeeder(items, snapshot?.annualCapacity, snapshot?.ratingAssumptionAmps, clock);
  }
  function ratioFor(item: Feeder) {
    const simulation = simulations.get(item.id)!;
    if (!simulation.sizingAvailable) return null;
    const rows = mapMode === "time" ? [simulation.rows[cursor]] : simulation.rows;
    return rows.reduce<number | null>((strongest, row) => {
      if (!row) return strongest;
      const power = enabled ? row.net : row.baseline;
      const ratio = power < 0 ? power / simulation.exportKw : power / simulation.importKw;
      return strongest === null || Math.abs(ratio) > Math.abs(strongest) ? ratio : strongest;
    }, null);
  }
  function colorFor(item: Feeder) {
    if (mapLayer === "value") {
      const value = snapshot?.sizing?.feeders[item.id]?.points[enabled ? homes : 0]?.tariffGbpPerKwh;
      return value === null || value === undefined ? "#e2e6ea" : capacityColor(-Math.min(1, value / 0.1));
    }
    const ratio = ratioFor(item);
    return ratio === null ? "#e2e6ea" : capacityColor(ratio);
  }
  const points = groups.map((item) => {
    const strongest = item.feeders.reduce<Feeder | null>((best, candidate) => {
      const ratio = ratioFor(candidate);
      return ratio !== null && (best === null || Math.abs(ratio) > Math.abs(ratioFor(best) ?? 0)) ? candidate : best;
    }, null);
    return { id: item.id, name: item.name, lat: item.lat, lon: item.lon, color: strongest ? colorFor(strongest) : "#e2e6ea", selected: item.id === group.id };
  });
  const lines = layout.traces.map((trace) => {
    const item = feeders.find((candidate) => candidate.id === trace.feederId);
    return { ...trace, color: item ? colorFor(item) : "#e2e6ea", selected: trace.feederId === feeder.id };
  });
  const matching = feeders.filter((item) => (item.substationName + " " + item.name).toLowerCase().includes(query.toLowerCase()));
  const transformer = transformerFor(group.feeders, snapshot);
  const transformerRating = transformer?.status === "published" ? transformer.ratingKva : null;
  const observed = clock.map((t) => monitoredPowerAt(group.feeders, t));
  const futureTransformer = snapshot.annualCapacity?.substations[group.id];
  const reference = clock.map(() => scenario === "long-term" ? futureTransformer?.status === "ready" ? futureTransformer.assetKw : null : transformerRating);
  const responsive = clock.map((_, index) => {
    if (group!.feeders.some(item => !simulations.get(item.id)!.sizingAvailable)) return null;
    const rows = group!.feeders.map(item => simulations.get(item.id)!.rows[index]);
    return rows.every(row => row !== null) ? rows.reduce((sum, row) => sum + (enabled ? row!.net : row!.baseline), 0) : null;
  });
  const baselineLimitCount = feeders.filter((item) => (simulations.get(item.id)!.baselinePeak ?? 0) > simulations.get(item.id)!.referenceImportKw).length;
  const netLimitCount = feeders.filter((item) => simulations.get(item.id)!.sizingAvailable && ((enabled ? simulations.get(item.id)!.netPeak : simulations.get(item.id)!.baselinePeak) ?? 0) > simulations.get(item.id)!.importKw).length;
  return <main className="story">
    <header className="site-header"><a className="brand" href="#top">Streetprice <span>/ Oxford</span></a><nav aria-label="Page sections"><a href="#feeder-story">The response</a><a href="#network">The network</a><a href="#money-title">The economics</a></nav><a className="social-link" href="https://x.com/dootonline" target="_blank" rel="noreferrer" aria-label="Doot Online on X">↗</a></header>
    <ScenarioControls scenario={scenario} onScenario={setScenario} clock={clock} cursor={cursor} onSeek={value => { setCursor(value); setMapMode("time"); }} batteryShare={batteryShare} onBatteryShare={setBatteryShare} />
    <section className="intro section" id="top"><h1>Reducing distribution network costs by x100–1000 with price signals</h1><p className="intro-summary">Distribution network costs are predominantly made up of fixed cost assets that must be over-sized for peak flows. With the advent of home batteries and VPPs becoming ubiquitous, power flows can be smoothed downstream of LV feeders &amp; substations with simple price signals. On the long-run, I propose that this will reduce distribution network costs &amp; capex 100-1000x.</p><p className="model-provenance"><span className="live-dot" />Real Oxford feeder readings · simulated battery response · assumed feeder limits</p>{snapshot.source === "fixture" ? <p className="data-banner">The historical snapshot is unavailable. These readings are a synthetic example.</p> : null}</section>
    <StoryHero feeder={feeder} annualHistory={snapshot.annualCapacity?.feeders[feeder.id]} sizing={snapshot.sizing?.feeders[feeder.id]} worstDay={snapshot.annualCapacity?.feeders[feeder.id]?.worstDay} annualCoverage={snapshot.annualCapacity?.feeders[feeder.id]?.coverage} result={result} config={config} parameters={snapshot.parameters} clock={clock} cursor={cursor} scenario={scenario} historyWindow={snapshot.annualCapacity?.window} windowLabel={snapshot.windowMode === "latest-available-24h" ? "Latest available 24h" : snapshot.windowMode === "previous-24h" ? "Previous 24h" : "Stored 24h"} batteryShare={batteryShare} onBatteryShare={setBatteryShare} onSeek={setCursor} />
    <section className="section narrative-section network-section" id="network" aria-labelledby="network-title">
      <div className="section-heading"><div><p className="eyebrow">02 / The Oxford network</p><h2 id="network-title">Oxford feeder loading</h2><p className="section-lede">Select a feeder to view its daily loading.</p></div><p className="network-count">187 feeders<br /><span>85 substations</span></p></div>
      <div className="map-toolbar"><div className="segmented" aria-label="Map loading time"><button aria-pressed={mapMode === "peak"} onClick={() => setMapMode("peak")}>Day’s peak</button><button aria-pressed={mapMode === "time"} onClick={() => setMapMode("time")}>Selected time</button></div><div className="segmented" aria-label="Map layer"><button aria-pressed={mapLayer === "loading"} onClick={() => setMapLayer("loading")}>Loading</button><button aria-pressed={mapLayer === "value"} onClick={() => setMapLayer("value")}>Flexibility value</button></div></div>
      <div className="network-grid"><figure className="map-column"><div className="map-card"><PriceMap points={points} lines={lines} stubs={layout.stubs} focus={focus} onSelectSubstation={(id) => { const chosen = groups.find((item) => item.id === id); if (chosen) selectFeeder(chosen.feeders[0].id); }} onSelectFeeder={(_substation, id) => selectFeeder(id)} onClearSelection={() => selectFeeder(defaultFeeder(feeders).id)} /><div className="map-legend">{mapLayer === "loading" ? <><span>Export 100%</span><i className="ratio-scale" /><span>Import 100%</span><span className="scale-caption">Grey = zero flow</span></> : <><span>0p</span><i className="value-scale" /><span>10p/kWh+</span></>}</div></div><figcaption className="figure-caption">{mapLayer === "loading" ? (mapMode === "peak" ? "Peak loading" : "Selected-time loading") + (scenario === "long-term" ? " · 12-month daily-peak sizing." : enabled ? " · simulated batteries." : " · no batteries.") : "Illustrative energy-only VPP tariff (p/kWh); grey = annual sizing unavailable."} Assumed limits; illustrative street traces.</figcaption><TimeSlider clock={clock} cursor={cursor} label="Map time" onSeek={(value) => { setCursor(value); setMapMode("time"); }} /></figure>
        <aside className="network-panel"><p className="eyebrow">Choose a feeder</p><label className="search-label">Substation or street<input type="search" aria-label="Search feeders" placeholder="Search Oxford feeders" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="feeder-picker" role="listbox" aria-label="Oxford feeders">{matching.map((item) => <button key={item.id} type="button" role="option" aria-selected={feeder.id === item.id} onClick={() => selectFeeder(item.id, true)}><span>{item.substationName}<small>{item.name}</small></span><span>{!simulations.get(item.id)!.sizingAvailable ? "No history" : simulations.get(item.id)!.baselinePeak === null ? "No data" : formatPct(((enabled ? simulations.get(item.id)!.netPeak : simulations.get(item.id)!.baselinePeak) ?? 0) / simulations.get(item.id)!.importKw)}</span></button>)}{matching.length === 0 ? <p>No matching feeders.</p> : null}</div><div className="network-result"><p><strong>{baselineLimitCount} → {scenario === "long-term" && !feeders.some(item => simulations.get(item.id)!.sizingAvailable) ? "—" : netLimitCount}</strong> feeders exceed the assumed import limit</p><small>{homes} simulated battery homes per feeder; available readings only.{scenario === "long-term" ? ` Annual sizing available for ${feeders.filter(item => simulations.get(item.id)!.sizingAvailable).length} / ${feeders.length}.` : ""}</small></div><a className="back-to-story" href="#feeder-story">Explore {feeder.substationName} {feeder.name} ↑</a></aside></div>
    </section>
    <SizingEconomics sizing={snapshot.sizing?.feeders[feeder.id]} homes={enabled ? homes : 0} parameters={snapshot.parameters} feeder={feeder} />
    <section className="section narrative-section technical-section" aria-labelledby="technical-title"><h2 id="technical-title">Model assumptions</h2>
      <details><summary>Feeder sizing and battery dispatch</summary><p>The proposed feeder capacity is recalculated from the recorded 12 months for the selected number of battery homes. The annual feasibility test carries battery charge between recorded half-hours and seeks the smallest thermal capacity that can serve observed import and export, assuming 10 kW / 25 kWh per home and 95% one-way efficiency. The 24-hour chart dispatches only above that proposed limit.</p><p>The illustrative energy-only tariff equals annualised marginal asset cost per kW divided by the recorded hours requiring that marginal kW of response. There is no availability payment or separate asset resizing cost. Battery ownership, charging energy, degradation, VPP margin and willingness to participate are not priced; this is not a live SSEN tariff. Missing load intervals and network engineering limits prevent this result from being a certified feeder design.</p></details>
      <details><summary>Shared transformer constraint at {group.name}</summary><p>{transformerRating !== null ? "Published transformer rating: " + transformerRating.toLocaleString() + " kVA (unity power factor assumed)." : "The transformer rating is missing or conflicting; no reference has been invented."} Dashed grey is observed power; the solid trace applies the selected battery scenario to each monitored feeder. Long-term mode uses the annual daily-peak size of the concurrent monitored-feeder sum; it is not a whole-substation replacement design. This is shared by outgoing feeders, not allocated equally between them. The trace sums monitored feeders only, excludes reactive power and is not total transformer utilisation or export permission. {scenario === "long-term" ? `Annual monitored-cohort reference: ${futureTransformer?.status === "ready" ? futureTransformer.assetKw?.toFixed(1) + " kW" : "unavailable"}.` : "The reference line uses the published rating at unity power factor."}</p><SeriesChart cursor={cursor} ariaLabel="Monitored substation power and selected capacity reference" yAxis={{ label: "Power (kW), PF = 1 reference", format: "number" }} bands={[{lower:reference.map(v=>v===null?null:v*.8),upper:reference,color:"rgba(185,66,63,.12)"}]} series={[{values:observed,color:"#8d98a3",width:1.5,dash:"5 5"},{values:responsive,color:enabled?"#1e7f66":"var(--ink)",width:2},{values:reference,color:"var(--reference)",width:1.5,dash:"5 5"}]} /><p>SSEN’s May 2026 rating/loading workbook and October 2026 load-model publication supply usable ratings for 79 sites; five disagreements and one missing site remain unresolved.</p></details>
      <details><summary>Data coverage and the selected day</summary><p>Display window: {formatStamp(snapshot.window.start)}–{formatStamp(snapshot.window.end)}. {snapshot.windowMode === "previous-24h" ? "The previous 24 hours at ingestion, ending at the latest completed half-hour." : snapshot.windowMode === "latest-available-24h" ? "Latest available 24 hours; SSEN returned no newer readings at ingestion." : "Stored historical window; refresh ingestion for the previous 24 hours."} Data through {formatStamp(snapshot.window.dataThrough)}. Real NeRDA power is averaged into half-hours. All three phases must be available; missing readings remain gaps. This feeder has {feeder.samples.length} of {clock.length} readings.</p><p>The map retains 187 feeders and 85 substations. Day-peak colours use available readings only; feeders with no readings are pale grey. This monitored cohort is not the entire Oxford network. Neither transformer nameplates nor observed demand maxima establish an individual feeder’s actual rating.</p></details>
      <details><summary>Economic assumptions and the long-run hypothesis</summary><p>The annual cost comparison assumes a feeder built at the calculated size from the start. Installed capacity is priced at £{snapshot.parameters.gbpPerKva}/kVA over {snapshot.parameters.lifeYears} years at {snapshot.parameters.discountRate * 100}% discount rate. Only dispatched battery energy receives a VPP payment. No extra cost is assigned to changing asset size.</p><p>Annual sizing uses the observed half-hours, with gaps excluded. The result assumes participating batteries can be controlled whenever needed; this tariff may not induce participation. Voltage, fault levels, phase imbalance, outages, demand growth, battery costs and incomplete monitoring remain outside the model. The proposed 100–1,000× reduction is a hypothesis, not a result established by these calculations.</p></details>
      <details><summary>Inspect the selected feeder’s readings</summary><div className="table-wrap"><table><caption>{feeder.substationName} {feeder.name} · real baseline / simulated response</caption><thead><tr><th>Time</th><th>Baseline kW</th><th>{scenario === "long-term" ? "Long-term kW" : enabled ? "With batteries kW" : "No battery kW"}</th><th>Battery kW</th><th>Stored kWh</th></tr></thead><tbody>{result.rows.filter((row) => row !== null).map((row) => <tr key={row.t}><td>{formatStamp(row.t)}</td><td>{row.baseline.toFixed(1)}</td><td>{(enabled ? row.net : row.baseline).toFixed(1)}</td><td>{(enabled ? row.batteryKw : 0).toFixed(1)}</td><td>{enabled ? row.storedKwh.toFixed(1) : "—"}</td></tr>)}</tbody></table></div></details>
    </section>
    <footer className="footer section"><p>SSEN NeRDA observations · Elexon wholesale data · OpenStreetMap street traces.</p><p>Experimental model. Not a tariff, operating instruction or guaranteed saving.</p></footer>
  </main>;
}
