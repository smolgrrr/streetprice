const CHARGE = [62, 106, 225];
const INK = [154, 163, 171];
const DISCHARGE = [225, 6, 0];

function mix(from: number[], to: number[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (index: number) =>
    Math.round(from[index] + (to[index] - from[index]) * clamped);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

/** Blue when a battery is paid to charge, red when it is paid to discharge. */
export function addonColor(addon: number, cap: number): string {
  if (!(cap > 0)) return mix(INK, INK, 0);
  const x = Math.max(-1, Math.min(1, addon / cap));
  if (x < 0) return mix(CHARGE, INK, 1 + x);
  return mix(INK, DISCHARGE, x);
}

const RATIO_STOPS = [
  { at: 0, rgb: [37, 78, 196] },
  { at: 0.5, rgb: [62, 106, 225] },
  { at: 1, rgb: [214, 214, 210] },
  { at: 1.5, rgb: [232, 96, 28] },
  { at: 2, rgb: [225, 6, 0] },
];

/** Heat colour for local price ÷ wholesale. Neutral grey at 1, blue below, red above. */
export function ratioColor(ratio: number): string {
  if (!Number.isFinite(ratio)) return "rgb(197 200 204)";
  const first = RATIO_STOPS[0];
  const last = RATIO_STOPS[RATIO_STOPS.length - 1];
  if (ratio <= first.at) return mix(first.rgb, first.rgb, 0);
  if (ratio >= last.at) return mix(last.rgb, last.rgb, 0);
  for (let index = 0; index < RATIO_STOPS.length - 1; index++) {
    const from = RATIO_STOPS[index];
    const to = RATIO_STOPS[index + 1];
    if (ratio <= to.at) return mix(from.rgb, to.rgb, (ratio - from.at) / (to.at - from.at));
  }
  return mix(last.rgb, last.rgb, 0);
}
