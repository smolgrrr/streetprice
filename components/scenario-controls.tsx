import { useState } from "react";
import { TimeSlider } from "./model-story";
import { assumedHouseholdsPerFeeder, batteryDefaults, batteryHomesForShare, type ViewScenario } from "@/lib/flexibility";

export function ScenarioControls({ scenario, onScenario, clock, cursor, onSeek, batteryShare, onBatteryShare }: {
  scenario: ViewScenario; onScenario: (scenario: ViewScenario) => void;
  clock: string[]; cursor: number; onSeek: (index: number) => void;
  batteryShare: number; onBatteryShare: (percent: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return <div className="scenario-bar">
    <div className="scenario-bar-inner">
      <span>Explore the model</span>
      <div className="segmented scenario-selector" role="group" aria-label="Network scenario">
        {([["none", "No battery"], ["battery", "Battery"]] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={scenario === value} onClick={() => onScenario(value)}>{label}</button>)}
      </div>
      <small>{scenario === "battery" ? "Battery response enabled" : "No battery response"}</small>
      <button className="sliders-toggle" type="button" aria-label={expanded ? "Hide model sliders" : "Show model sliders"}
        aria-expanded={expanded} aria-controls="model-sliders" onClick={() => setExpanded(value => !value)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    <div id="model-sliders" className="model-sliders" hidden={!expanded}>
      <TimeSlider clock={clock} cursor={cursor} onSeek={onSeek} label="Selected time" />
      <div className="battery-share-control">
        <div><label htmlFor="battery-share">Households with a battery</label><strong>{batteryShare}%</strong></div>
        <input id="battery-share" type="range" min="0" max="100" step="1" value={batteryShare}
          aria-valuetext={`${batteryShare}% of households, ${batteryHomesForShare(batteryShare)} simulated battery homes per feeder`}
          onChange={event => onBatteryShare(Number(event.target.value))} />
        <small>Assumes {assumedHouseholdsPerFeeder} homes/feeder · {batteryDefaults.powerPerHomeKw} kW / {batteryDefaults.energyPerHomeKwh} kWh per battery{scenario === "none" ? " · response off" : ""}</small>
      </div>
    </div>
  </div>;
}
