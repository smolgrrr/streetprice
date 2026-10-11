const CHARGE = [49, 95, 125];
const NEUTRAL = [151, 157, 153];
const DISCHARGE = [154, 73, 62];

function mix(from: number[], to: number[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (index: number) =>
    Math.round(from[index] + (to[index] - from[index]) * clamped);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

/** Blue when a battery is paid to charge, red when it is paid to discharge. */
export function addonColor(addon: number, cap: number): string {
  if (!(cap > 0)) return mix(NEUTRAL, NEUTRAL, 0);
  const x = Math.max(-1, Math.min(1, addon / cap));
  if (x < 0) return mix(CHARGE, NEUTRAL, 1 + x);
  return mix(NEUTRAL, DISCHARGE, x);
}

const RATIO_STOPS = [
  { at: 0, rgb: [38, 79, 112] },
  { at: 0.5, rgb: [79, 120, 147] },
  { at: 1, rgb: [208, 206, 198] },
  { at: 1.5, rgb: [184, 107, 80] },
  { at: 2, rgb: [141, 64, 56] },
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

/** Signed capacity loading: −1 is the export limit, 0 is zero flow, +1 is the import limit. */
export function capacityColor(signedLoading: number): string {
  const zero = [208, 206, 198];
  if (!Number.isFinite(signedLoading)) return "rgb(226 226 222)";
  return mix(zero, signedLoading < 0 ? CHARGE : DISCHARGE, Math.abs(signedLoading));
}
