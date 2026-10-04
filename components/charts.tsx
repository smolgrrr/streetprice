type Series = {
  values: number[];
  color: string;
  width: number;
  dash?: string;
};

export function SeriesChart({ series, cursor }: { series: Series[]; cursor: number }) {
  const width = 320;
  const height = 88;
  const values = series.flatMap((item) => item.values);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const count = series[0]?.values.length ?? 1;
  const x = (index: number) => (count <= 1 ? 0 : (index / (count - 1)) * width);
  const y = (value: number) => height - 6 - ((value - min) / span) * (height - 12);
  const cursorIndex = Math.max(0, Math.min(cursor, count - 1));

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true">
      {series.map((item, seriesIndex) => (
        <path
          key={seriesIndex}
          d={item.values
            .map(
              (value, index) =>
                `${index === 0 ? "M" : "L"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`,
            )
            .join(" ")}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width}
          strokeDasharray={item.dash}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <line
        x1={x(cursorIndex)}
        x2={x(cursorIndex)}
        y1={2}
        y2={height - 2}
        stroke="#17202a"
        strokeOpacity={0.35}
      />
    </svg>
  );
}
