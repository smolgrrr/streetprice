const CHARGE = [15, 110, 106];
const INK = [23, 32, 42];
const DISCHARGE = [210, 69, 30];

function mix(from: number[], to: number[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (index: number) =>
    Math.round(from[index] + (to[index] - from[index]) * clamped);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

/** Teal when a battery is paid to charge, cadmium when it is paid to discharge. */
export function addonColor(addon: number, cap: number): string {
  if (!(cap > 0)) return mix(INK, INK, 0);
  const x = Math.max(-1, Math.min(1, addon / cap));
  if (x < 0) return mix(CHARGE, INK, 1 + x);
  return mix(INK, DISCHARGE, x);
}
