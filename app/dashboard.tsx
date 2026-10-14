"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { StoryHero } from "@/components/model-story";
import { ScenarioControls } from "@/components/scenario-controls";
import { batteryDefaults, batteryHomesForShare, simulateFlexibility, type ViewScenario } from "@/lib/flexibility";
import { capacityColor } from "@/lib/color";
import { defaultScenario } from "@/lib/constraint";
import { formatTime } from "@/lib/format";
import { substationsOf } from "@/lib/group";
import type { DashboardSnapshot, Feeder } from "@/lib/types";
import { openingFeeder } from "@/lib/worst-day";

const PriceMap = dynamic(() => import("@/components/price-map").then(module => module.PriceMap), {
  ssr: false,
  loading: () => <div className="map-loading">Loading the map…</div>,
});

function clockOf(snapshot: DashboardSnapshot) {
  const start = Date.parse(snapshot.window.start);
  const end = Date.parse(snapshot.window.end);
  return Array.from({ length: Math.round((end - start) / 1800000) }, (_, index) => new Date(start + index * 1800000).toISOString());
}

export function Dashboard({ snapshot }: { snapshot: DashboardSnapshot }) {
  const feeders = snapshot.feeders;
  const clock = useMemo(() => clockOf(snapshot), [snapshot]);
  const [feederId, setFeederId] = useState(() => openingFeeder(feeders, snapshot.annualCapacity, snapshot.ratingAssumptionAmps, clock).id);
  const [cursor, setCursor] = useState(Math.max(0, clock.length - 1));
  const [scenario, setScenario] = useState<ViewScenario>("battery");
  const [batteryShare, setBatteryShare] = useState(33);
  const groups = useMemo(() => substationsOf(feeders), [feeders]);
  const layout = snapshot.streets;
  const config = useMemo(() => ({ ...batteryDefaults, households: batteryHomesForShare(batteryShare) }), [batteryShare]);
  const simulations = useMemo(() => new Map(feeders.map(feeder => {
    const capacityKw = snapshot.capacities[feeder.id]?.[config.households];
    const annual = snapshot.annualCapacity?.feeders[feeder.id];
    const target = scenario === "battery" && capacityKw != null && annual?.status === "ready"
      ? { ...annual, assetKw: capacityKw } : undefined;
    return [feeder.id, simulateFlexibility(feeder, clock, config, snapshot.ratingAssumptionAmps, target, "limit")] as const;
  })), [feeders, clock, config, snapshot, scenario]);

  const feeder = feeders.find(item => item.id === feederId) ?? feeders[0];
  const result = feeder ? simulations.get(feeder.id) : undefined;
  if (!feeder || !result || !clock.length) return <main className="status"><h1>The Oxford snapshot has no usable feeder data.</h1></main>;

  // A map percentage always means loading against today's assumed directional limit.
  function loading(item: Feeder) {
    const simulation = simulations.get(item.id)!;
    const row = simulation.rows[cursor];
    if (!row) return null;
    const annual = snapshot.annualCapacity?.feeders[item.id];
    const capacityKw = snapshot.capacities[item.id]?.[config.households];
    const power = scenario === "battery" && capacityKw != null && annual?.status === "ready" ? row.net : row.baseline;
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
      <h1>Reducing distribution network costs by 45% with price signals</h1>
      <p className="intro-summary">Distribution network costs are predominantly made up of fixed cost assets that must be over-sized for peak flows. With the advent of home batteries and VPPs becoming ubiquitous, power flows can be smoothed downstream of LV feeders &amp; substations with simple price signals. On the long-run, I propose that this will reduce distribution network costs &amp; capex by 45%.</p>
    </section>
    <ScenarioControls scenario={scenario} onScenario={setScenario} clock={clock} cursor={cursor} onSeek={setCursor} batteryShare={batteryShare} onBatteryShare={setBatteryShare} />
    <StoryHero feeder={feeder} worstDay={snapshot.annualCapacity?.feeders[feeder.id]?.worstDay}
      annual={snapshot.annualCapacity?.feeders[feeder.id]} proposedCapacityKw={snapshot.capacities[feeder.id]?.[config.households] ?? null}
      localTariffGbpPerKwh={snapshot.tariffs[feeder.id]?.[config.households] ?? (config.households === 0 ? 0 : null)}
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
