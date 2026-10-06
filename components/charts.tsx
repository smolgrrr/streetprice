type Series = {
  values: Array<number | null>;
  color: string;
  width: number;
  dash?: string;
};

function pathsFor(
  values: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
): string[] {
  const paths: string[] = [];
  let current = "";
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current) paths.push(current);
      current = "";
      return;
    }
    current += `${current ? " L" : "M"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
  });
  if (current) paths.push(current);
  return paths;
}

export function SeriesChart({
  series,
  cursor,
  ariaLabel,
  yAxis,
}: {
  series: Series[];
  cursor: number;
  ariaLabel: string;
  yAxis?: { label: string; format: "price" | "number" };
}) {
  const width = 960;
  const height = 260;
  const values = series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  if (values.length === 0) return <p className="chart-empty">No complete samples at this time.</p>;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const minimumPadding = yAxis?.format === "price" ? 0.01 : 1;
  const padding = Math.max(minimumPadding, (rawMax - rawMin) * 0.08);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const span = max - min || 1;
  const count = Math.max(1, ...series.map((item) => item.values.length));
  const left = yAxis ? 78 : 0;
  const right = 4;
  const top = yAxis ? 28 : 18;
  const bottom = 18;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + (count <= 1 ? 0 : (index / (count - 1)) * plotWidth);
  const y = (value: number) => top + ((max - value) / span) * plotHeight;
  const cursorIndex = Math.max(0, Math.min(cursor, count - 1));
  const ticks = Array.from({ length: 5 }, (_, index) => max - (span * index) / 4);
  const gridTicks = yAxis ? ticks : [max - span * 0.25, max - span * 0.5, max - span * 0.75];
  const tickLabel = (value: number) => {
    if (yAxis?.format === "price") {
      const sign = value < 0 ? "−" : "";
      return `${sign}£${Math.abs(value).toFixed(2)}`;
    }
    return value.toFixed(0);
  };

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {yAxis ? <text x={left} y={14} className="chart-y-title">{yAxis.label}</text> : null}
      {gridTicks.map((value) => (
        <g key={value}>
          {yAxis ? (
            <text x={left - 10} y={y(value) + 4} textAnchor="end" className="chart-y-tick">
              {tickLabel(value)}
            </text>
          ) : null}
        <line
          x1={left}
          x2={width - right}
          y1={y(value)}
          y2={y(value)}
          className="chart-grid"
        />
        </g>
      ))}
      {series.map((item, seriesIndex) =>
        pathsFor(item.values, x, y).map((path, pathIndex) => (
          <path
            key={`${seriesIndex}-${pathIndex}`}
            d={path}
            fill="none"
            stroke={item.color}
            strokeWidth={item.width}
            strokeDasharray={item.dash}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      <line
        x1={x(cursorIndex)}
        x2={x(cursorIndex)}
        y1={top}
        y2={height - bottom}
        className="chart-cursor"
      />
    </svg>
  );
}
