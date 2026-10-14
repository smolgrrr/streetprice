import { TimeSlider } from "./model-story";
import { type ViewScenario } from "@/lib/flexibility";

export function ScenarioControls({ scenario, onScenario, clock, cursor, onSeek, batteryShare, onBatteryShare }: {
  scenario: ViewScenario;
  onScenario: (scenario: ViewScenario) => void;
  clock: string[];
  cursor: number;
  onSeek: (index: number) => void;
  batteryShare: number;
  onBatteryShare: (percent: number) => void;
}) {
  return <div className="scenario-bar"><div className="scenario-bar-inner">
    <div className="scenario-selector" role="group" aria-label="Battery scenario">
      <button type="button" aria-pressed={scenario === "none"} onClick={() => onScenario("none")}>No battery</button>
      <button type="button" aria-pressed={scenario === "battery"} onClick={() => onScenario("battery")}>Battery</button>
    </div>
    <div className="battery-share-control">
      <div><label htmlFor="battery-share">Households with a battery</label><strong>{batteryShare}%</strong></div>
      <input id="battery-share" type="range" min="0" max="100" step="1" value={batteryShare}
        onChange={event => onBatteryShare(Number(event.target.value))} />
    </div>
    <TimeSlider clock={clock} cursor={cursor} onSeek={onSeek} label="Time" />
  </div></div>;
}
