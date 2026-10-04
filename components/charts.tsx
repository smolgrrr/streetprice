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
}: {
  series: Series[];
  cursor: number;
  ariaLabel: string;
}) {
  const width = 960;
  const height = 260;
  const values = series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  if (values.length === 0) return <p className="chart-empty">No complete samples at this time.</p>;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(1, (rawMax - rawMin) * 0.08);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const span = max - min || 1;
  const count = Math.max(1, ...series.map((item) => item.values.length));
  const x = (index: number) => (count <= 1 ? 0 : (index / (count - 1)) * width);
  const y = (value: number) => height - 18 - ((value - min) / span) * (height - 36);
  const cursorIndex = Math.max(0, Math.min(cursor, count - 1));

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {[0.25, 0.5, 0.75].map((position) => (
        <line
          key={position}
          x1={0}
          x2={width}
          y1={height * position}
          y2={height * position}
          className="chart-grid"
        />
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
        y1={5}
        y2={height - 5}
        className="chart-cursor"
      />
    </svg>
  );
}
