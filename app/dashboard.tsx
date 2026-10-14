"use client";

import { useEffect, useMemo, useState } from "react";
import { PriceMap } from "@/components/price-map";
import { StoryHero } from "@/components/model-story";
import { ScenarioControls } from "@/components/scenario-controls";
import { batteryDefaults, batteryHomesForShare, simulateFlexibility, type ViewScenario } from "@/lib/flexibility";
import { capacityColor } from "@/lib/color";
import { defaultScenario } from "@/lib/constraint";
import { formatTime } from "@/lib/format";
import { substationsOf } from "@/lib/group";
import { streetLayout } from "@/lib/street-trace";
import type { Feeder, Snapshot } from "@/lib/types";
import { openingFeeder } from "@/lib/worst-day";

function clockOf(snapshot: Snapshot) {
  const start = Date.parse(snapshot.window.start);
  const end = Date.parse(snapshot.window.end);
  return Array.from({ length: Math.round((end - start) / 1800000) }, (_, index) => new Date(start + index * 1800000).toISOString());
}

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [feederId, setFeederId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [scenario, setScenario] = useState<ViewScenario>("none");
  const [batteryShare, setBatteryShare] = useState(33);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/snapshot", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Snapshot unavailable");
      return await response.json() as Snapshot;
    }).then(data => {
      if (controller.signal.aborted) return;
      setSnapshot(data);
      setFeederId(openingFeeder(data.feeders, data.annualCapacity, data.ratingAssumptionAmps, clockOf(data)).id);
      setCursor(Math.max(0, clockOf(data).length - 1));
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);

  const feeders = useMemo(() => snapshot?.feeders ?? [], [snapshot]);
  const clock = useMemo(() => snapshot ? clockOf(snapshot) : [], [snapshot]);
  const groups = useMemo(() => substationsOf(feeders), [feeders]);
  const layout = useMemo(() => snapshot?.streets ?? streetLayout(feeders), [snapshot, feeders]);
  const config = useMemo(() => ({ ...batteryDefaults, households: batteryHomesForShare(batteryShare) }), [batteryShare]);
  const simulations = useMemo(() => new Map(feeders.map(feeder => {
    const point = snapshot?.sizing?.feeders[feeder.id]?.points[config.households];
    const annual = snapshot?.annualCapacity?.feeders[feeder.id];
    const target = scenario === "battery" && point?.capacityKw != null && annual?.status === "ready"
      ? { ...annual, assetKw: point.capacityKw } : undefined;
    return [feeder.id, simulateFlexibility(feeder, clock, config, snapshot?.ratingAssumptionAmps, target, "limit")] as const;
  })), [feeders, clock, config, snapshot, scenario]);

  const feeder = feeders.find(item => item.id === feederId) ?? feeders[0];
  const result = feeder ? simulations.get(feeder.id) : undefined;
  if (error) return <main className="status"><h1>The Oxford snapshot could not be loaded.</h1><p>Please reload to try again.</p></main>;
  if (!snapshot || !feeder || !result || !clock.length) return <main className="status"><h1>Loading the Oxford model…</h1></main>;

  // A map percentage always means loading against today's assumed directional limit.
  function loading(item: Feeder) {
    const simulation = simulations.get(item.id)!;
    const row = simulation.rows[cursor];
    if (!row) return null;
    const annual = snapshot!.annualCapacity?.feeders[item.id];
    const point = snapshot!.sizing?.feeders[item.id]?.points[config.households];
    const power = scenario === "battery" && point?.capacityKw != null && annual?.status === "ready" ? row.net : row.baseline;
    return power < 0 ? power / defaultScenario.exportKw! : power / simulation.referenceImportKw;
  }
  function color(item: Feeder) {
    const ratio = loading(item);
    return ratio === null ? "#e2e6ea" : capacityColor(ratio);
  }
  const points = groups.map(group => {
    const strongest = group.feeders.reduce<Feeder | null>((best, candidate) => {
      const ratio = loading(candidate);
      return ratio !== null && (best === null || Math.abs(ratio) > Math.abs(loading(best) ?? 0)) ? candidate : best;
    }, null);
    return { id: group.id, name: group.name, lat: group.lat, lon: group.lon,
      color: strongest ? color(strongest) : "#e2e6ea", selected: group.id === feeder.substationId };
  });
  const lines = layout.traces.map(trace => {
    const item = feeders.find(candidate => candidate.id === trace.feederId);
    return { ...trace, color: item ? color(item) : "#e2e6ea", selected: trace.feederId === feeder.id };
  });
  function selectFeeder(id: string) {
    if (!feeders.some(item => item.id === id)) return;
    setFeederId(id);
    document.getElementById("figure-1")?.scrollIntoView({ behavior: "smooth" });
  }

  return <main className="story">
    <section className="intro section">
      <h1>Reducing distribution network costs by x100–1000 with price signals</h1>
      <p className="intro-summary">Distribution network costs are predominantly made up of fixed cost assets that must be over-sized for peak flows. With the advent of home batteries and VPPs becoming ubiquitous, power flows can be smoothed downstream of LV feeders &amp; substations with simple price signals. On the long-run, I propose that this will reduce distribution network costs &amp; capex 100-1000x.</p>
    </section>
    <ScenarioControls scenario={scenario} onScenario={setScenario} clock={clock} cursor={cursor} onSeek={setCursor} batteryShare={batteryShare} onBatteryShare={setBatteryShare} />
    <StoryHero feeder={feeder} worstDay={snapshot.annualCapacity?.feeders[feeder.id]?.worstDay}
      annual={snapshot.annualCapacity?.feeders[feeder.id]} sizing={snapshot.sizing?.feeders[feeder.id]}
      result={result} config={config} clock={clock} cursor={cursor} scenario={scenario} />
    <section className="section network-section" aria-labelledby="map-title">
      <p className="eyebrow">Heat map</p>
      <h2 id="map-title">Oxford feeder loading at {formatTime(clock[cursor])}</h2>
      <p className="section-lede">Tap a feeder to see its 24-hour trace above. Colours show flow as a share of today’s assumed limit, even when batteries are selected.</p>
      <figure>
        <div className="map-card">
          <PriceMap points={points} lines={lines} stubs={layout.stubs}
            onSelectSubstation={id => { const group = groups.find(item => item.id === id); if (group) selectFeeder(group.feeders[0].id); }}
            onSelectFeeder={(_substation, id) => selectFeeder(id)} />
          <div className="map-legend"><span>Export 100%</span><i className="ratio-scale" /><span>Import 100%</span><small>Grey = near zero</small></div>
        </div>
        <figcaption>Figure 2. Selected half-hour; assumed limits, not measured feeder ratings. Grey also marks missing readings. Street traces are illustrative.</figcaption>
      </figure>
    </section>
  </main>;
}
