import { useState } from 'react';

type BarDatum = { label: string; value: number; count: number };
type TimeDatum = { date: string; score: number };

type Props = {
  heroLabel: string;
  overallAverage: number | null;
  byLaneCondition: BarDatum[];
  byBall: BarDatum[];
  averageOverTime: TimeDatum[];
};

const WIDTH = 320;
const HEIGHT = 180;

function roundedTopBarPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height);
  return `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`;
}

function truncate(label: string, max = 8) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function BarChart({ title, data, unit }: { title: string; data: BarDatum[]; unit: string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="chart-card">
        <h2>{title}</h2>
        <p className="chart-empty">Not enough data yet.</p>
      </div>
    );
  }

  const padding = { top: 10, right: 10, bottom: 32, left: 10 };
  const chartWidth = WIDTH - padding.left - padding.right;
  const chartHeight = HEIGHT - padding.top - padding.bottom;
  const barGap = 8;
  const barWidth = Math.min(24, (chartWidth - barGap * (data.length - 1)) / data.length);
  const totalBarsWidth = barWidth * data.length + barGap * (data.length - 1);
  const startX = padding.left + Math.max(0, (chartWidth - totalBarsWidth) / 2);
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="chart-card">
      <h2>{title}</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" role="img" aria-label={title}>
        <line
          x1={padding.left}
          y1={HEIGHT - padding.bottom}
          x2={WIDTH - padding.right}
          y2={HEIGHT - padding.bottom}
          className="chart-axis"
        />
        {data.map((d, i) => {
          const barHeight = Math.max((d.value / max) * chartHeight, 2);
          const x = startX + i * (barWidth + barGap);
          const y = HEIGHT - padding.bottom - barHeight;
          return (
            <g
              key={d.label}
              onPointerEnter={() => setHovered(i)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${d.value.toFixed(1)} ${unit}, ${d.count} games`}
            >
              <path d={roundedTopBarPath(x, y, barWidth, barHeight, 4)} className={`chart-bar${hovered === i ? ' hovered' : ''}`} />
              <text x={x + barWidth / 2} y={HEIGHT - padding.bottom + 16} textAnchor="middle" className="chart-tick">
                {truncate(d.label)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="chart-tooltip" aria-live="polite">
        {hovered != null
          ? `${data[hovered].label}: ${data[hovered].value.toFixed(1)} ${unit} (${data[hovered].count} game${data[hovered].count === 1 ? '' : 's'})`
          : ' '}
      </p>
      <details>
        <summary>View as table</summary>
        <table className="chart-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>{unit}</th>
              <th>Games</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td>{d.value.toFixed(1)}</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function LineChart({ title, data }: { title: string; data: TimeDatum[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="chart-card">
        <h2>{title}</h2>
        <p className="chart-empty">Not enough data yet.</p>
      </div>
    );
  }

  const padding = { top: 15, right: 12, bottom: 26, left: 12 };
  const chartWidth = WIDTH - padding.left - padding.right;
  const chartHeight = HEIGHT - padding.top - padding.bottom;
  const scores = data.map((d) => d.score);
  const yMax = Math.max(...scores, 10);
  const xStep = data.length > 1 ? chartWidth / (data.length - 1) : 0;

  const xFor = (i: number) => padding.left + i * xStep;
  const yFor = (v: number) => padding.top + chartHeight - (v / yMax) * chartHeight;

  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d.score)}`).join(' ');

  return (
    <div className="chart-card">
      <h2>{title}</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" role="img" aria-label={title}>
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={WIDTH - padding.right}
          y2={padding.top + chartHeight}
          className="chart-axis"
        />
        <path d={pathD} className="chart-line" fill="none" />
        {data.map((d, i) => (
          <g
            key={`${d.date}-${i}`}
            onPointerEnter={() => setHovered(i)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            tabIndex={0}
            role="img"
            aria-label={`${d.date}: average ${d.score.toFixed(1)}`}
          >
            <circle cx={xFor(i)} cy={yFor(d.score)} r={12} className="chart-hit" />
            <circle cx={xFor(i)} cy={yFor(d.score)} r={6} className="chart-dot-ring" />
            <circle cx={xFor(i)} cy={yFor(d.score)} r={4} className={`chart-dot${hovered === i ? ' hovered' : ''}`} />
          </g>
        ))}
      </svg>
      <p className="chart-tooltip" aria-live="polite">
        {hovered != null ? `${data[hovered].date}: average ${data[hovered].score.toFixed(1)}` : ' '}
      </p>
      <details>
        <summary>View as table</summary>
        <table className="chart-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Running average</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.date}-${i}`}>
                <td>{d.date}</td>
                <td>{d.score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function StatsCharts({ heroLabel, overallAverage, byLaneCondition, byBall, averageOverTime }: Props) {
  return (
    <div className="stats-charts">
      <div className="hero-stat">
        <span className="hero-label">{heroLabel}</span>
        <span className="hero-value">{overallAverage != null ? overallAverage.toFixed(1) : '—'}</span>
      </div>

      <LineChart title="Average over time" data={averageOverTime} />
      <BarChart title="Average by lane condition" data={byLaneCondition} unit="avg score" />
      <BarChart title="Avg pins per shot, by ball" data={byBall} unit="pins/shot" />
    </div>
  );
}
