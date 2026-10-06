const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatTime(t: string): string {
  return time.format(new Date(t));
}

export function formatStamp(t: string): string {
  return stamp.format(new Date(t));
}

export function formatPrice(value: number): string {
  return Math.round(value).toString();
}

export function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}`;
  return rounded.toString();
}

/** Sterling per kWh. The model stores pounds per MWh. */
export function formatKwhPrice(gbpPerMwh: number, signed = false): string {
  const text = (Math.abs(gbpPerMwh) / 1000).toFixed(3);
  if (gbpPerMwh < 0) return `−£${text}`;
  if (signed && gbpPerMwh > 0) return `+£${text}`;
  return `£${text}`;
}

export function formatCurrencyPrice(value: number, signed = false): string {
  return formatKwhPrice(value, signed);
}

export function formatPounds(value: number): string {
  const sign = value < 0 ? "−" : "";
  return `${sign}£${Math.abs(value).toFixed(2)}`;
}

export function formatPct(loading: number): string {
  return `${Math.round(loading * 100)}%`;
}

export function formatKw(value: number): string {
  return `${Math.round(value)} kW`;
}
