import { useState } from 'react';
import type { RateStats, LeaveConversion, PinLeaveStat } from '../lib/stats';

type BarDatum = { label: string; value: number; count: number };
type TimeDatum = { date: string; score: number };

type Props = {
  heroLabel: string;
  overallAverage: number | null;
  handicappedAverage: number | null;
  byLaneCondition: BarDatum[];
  byBall: BarDatum[];
  byLeague: BarDatum[];
  averageOverTime: TimeDatum[];
  averageDrift: number | null;
  driftShotCount: number;
  rateStats: RateStats | null;
  leaveConversions: LeaveConversion[];
  pinLeaveStats: PinLeaveStat[];
};

/** Signed drift (stance − slide) → "Straight" or "2.3 boards right/left". */
function formatDrift(boards: number): string {
  const abs = Math.abs(boards);
  if (abs < 0.05) return 'Straight';
  const unit = abs.toFixed(1) === '1.0' ? 'board' : 'boards';
  return `${abs.toFixed(1)} ${unit} ${boards > 0 ? 'right' : 'left'}`;
}

/** "62%" for 62/118, an em dash when there have been no opportunities. */
function formatRate(made: number, opportunities: number): string {
  if (opportunities === 0) return '—';
  return `${Math.round((made / opportunities) * 100)}%`;
}

function RateTile({ label, made, opportunities, noun }: { label: string; made: number; opportunities: number; noun: string }) {
  return (
    <div className="rate-stat">
      <span className="rate-label">{label}</span>
      <span className="rate-value">{formatRate(made, opportunities)}</span>
      <span className="rate-sub">{opportunities === 0 ? `No ${noun} yet` : `${made} of ${opportunities} ${noun}`}</span>
    </div>
  );
}

function LeaveConversionTable({ data }: { data: LeaveConversion[] }) {
  return (
    <div className="chart-card">
      <h2>Spare Conversion by Leave</h2>
      {data.length === 0 ? (
        <p className="chart-empty">Not enough data yet.</p>
      ) : (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Leave</th>
              <th>Converted</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>
                  {d.converted}/{d.attempts}
                </td>
                <td>{formatRate(d.converted, d.attempts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const PIN_ROWS = [
  [7, 8, 9, 10],
  [4, 5, 6],
  [2, 3],
  [1],
];

const PIN_PATH =
  'M20,4 C27,4 27,14 24,20 C22,24 22,26 24,30 C30,38 33,58 30,76 C29,88 25,96 20,96 C15,96 11,88 10,76 C7,58 10,38 16,30 C18,26 18,24 16,20 C13,14 13,4 20,4 Z';

/** Read-only pin glyph shaded by how often that pin gets left standing --
 *  darker/filled = left more often, relative to the pin left most. */
function PinFrequencyGlyph({ pin, attempts, converted, maxAttempts }: PinLeaveStat & { maxAttempts: number }) {
  const intensity = maxAttempts === 0 ? 0 : attempts / maxAttempts;
  return (
    <div className="pin-freq" title={`Pin ${pin}: left ${attempts}x, converted ${formatRate(converted, attempts)}`}>
      <svg className="pin-svg" viewBox="0 0 40 100" aria-hidden="true">
        <path
          className="pin-body"
          d={PIN_PATH}
          style={{ fillOpacity: 0.15 + intensity * 0.85 }}
        />
        <text className="pin-num" x="20" y="64" textAnchor="middle" dominantBaseline="middle">
          {pin}
        </text>
      </svg>
      <span className="pin-freq-count">{attempts}</span>
      <span className="pin-freq-rate">{attempts === 0 ? '—' : formatRate(converted, attempts)}</span>
    </div>
  );
}

function PinLeaveDiagram({ data }: { data: PinLeaveStat[] }) {
  const maxAttempts = Math.max(...data.map((d) => d.attempts), 0);
  const byPin = new Map(data.map((d) => [d.pin, d]));

  return (
    <div className="chart-card">
      <h2>Pin Leave Frequency</h2>
      {maxAttempts === 0 ? (
        <p className="chart-empty">Not enough data yet.</p>
      ) : (
        <>
          <div className="pin-freq-rows">
            {PIN_ROWS.map((row, i) => (
              <div className="pin-freq-row" key={i}>
                {row.map((pin) => {
                  const d = byPin.get(pin)!;
                  return <PinFrequencyGlyph key={pin} {...d} maxAttempts={maxAttempts} />;
                })}
              </div>
            ))}
          </div>
          <p className="chart-hint">Shade = how often left standing; number below = times converted.</p>
          <details>
            <summary>View as Table</summary>
            <table className="chart-table">
              <thead>
                <tr>
                  <th>Pin</th>
                  <th>Left</th>
                  <th>Converted</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.pin}>
                    <td>{d.pin}</td>
                    <td>{d.attempts}</td>
                    <td>{formatRate(d.converted, d.attempts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

const WIDTH = 320;
const HEIGHT = 180;

function roundedTopBarPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height);
  return `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`;
}

function truncate(label: string, max = 8) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** A "nice" round number near `range` (D3's classic nice-ticks algorithm). */
function niceNumber(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return niceFraction * 10 ** exponent;
}

/** Clean round tick values from 0 up to at least `max`, ~targetCount of them --
 *  so a y-axis reads "0 / 100 / 200" instead of whatever the data happened to hit. */
function niceTicks(max: number, targetCount = 4): number[] {
  if (max <= 0) return [0, 1];
  const step = niceNumber(niceNumber(max, false) / Math.max(1, targetCount - 1), true);
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** "2026-07-16" -> "Jul 16", for compact x-axis date ticks. */
function formatDateTick(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Evenly-spaced indices into a length-n series, capped at maxTicks, always
 *  including the first and last point. */
function pickTickIndices(n: number, maxTicks = 4): number[] {
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
  const indices = new Set<number>();
  for (let i = 0; i < maxTicks; i += 1) indices.add(Math.round((i * (n - 1)) / (maxTicks - 1)));
  return Array.from(indices).sort((a, b) => a - b);
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

  const padding = { top: 18, right: 10, bottom: 32, left: 10 };
  const chartWidth = WIDTH - padding.left - padding.right;
  const chartHeight = HEIGHT - padding.top - padding.bottom;
  const barGap = 8;
  const barWidth = Math.min(24, (chartWidth - barGap * (data.length - 1)) / data.length);
  const totalBarsWidth = barWidth * data.length + barGap * (data.length - 1);
  const startX = padding.left + Math.max(0, (chartWidth - totalBarsWidth) / 2);
  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const yTicks = niceTicks(rawMax);
  const max = yTicks[yTicks.length - 1];
  const yFor = (v: number) => HEIGHT - padding.bottom - (v / max) * chartHeight;

  return (
    <div className="chart-card">
      <h2>{title}</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" role="img" aria-label={title}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padding.left} y1={yFor(t)} x2={WIDTH - padding.right} y2={yFor(t)} className="chart-gridline" />
            <text x={padding.left + 2} y={yFor(t) - 3} className="chart-axis-label">
              {t}
            </text>
          </g>
        ))}
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
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="chart-value">
                {d.value.toFixed(1)}
              </text>
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
        <summary>View as Table</summary>
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

  const padding = { top: 15, right: 34, bottom: 26, left: 12 };
  const chartWidth = WIDTH - padding.left - padding.right;
  const chartHeight = HEIGHT - padding.top - padding.bottom;
  const scores = data.map((d) => d.score);
  const yTicks = niceTicks(Math.max(...scores, 1));
  const yMax = yTicks[yTicks.length - 1];
  const xStep = data.length > 1 ? chartWidth / (data.length - 1) : 0;

  const xFor = (i: number) => padding.left + i * xStep;
  const yFor = (v: number) => padding.top + chartHeight - (v / yMax) * chartHeight;

  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d.score)}`).join(' ');
  const xTickIndices = pickTickIndices(data.length);
  const last = data[data.length - 1];

  return (
    <div className="chart-card">
      <h2>{title}</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" role="img" aria-label={title}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padding.left} y1={yFor(t)} x2={WIDTH - padding.right} y2={yFor(t)} className="chart-gridline" />
            <text x={padding.left + 2} y={yFor(t) - 3} className="chart-axis-label">
              {t}
            </text>
          </g>
        ))}
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={WIDTH - padding.right}
          y2={padding.top + chartHeight}
          className="chart-axis"
        />
        {xTickIndices.map((i) => (
          <text
            key={i}
            x={xFor(i)}
            y={padding.top + chartHeight + 14}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            className="chart-tick"
          >
            {formatDateTick(data[i].date)}
          </text>
        ))}
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
        <text x={WIDTH - 2} y={yFor(last.score) - 8} textAnchor="end" className="chart-endlabel">
          {last.score.toFixed(1)}
        </text>
      </svg>
      <p className="chart-tooltip" aria-live="polite">
        {hovered != null ? `${data[hovered].date}: average ${data[hovered].score.toFixed(1)}` : ' '}
      </p>
      <details>
        <summary>View as Table</summary>
        <table className="chart-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Running Average</th>
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

export default function StatsCharts({
  heroLabel,
  overallAverage,
  handicappedAverage,
  byLaneCondition,
  byBall,
  byLeague,
  averageOverTime,
  averageDrift,
  driftShotCount,
  rateStats,
  leaveConversions,
  pinLeaveStats,
}: Props) {
  return (
    <div className="stats-charts">
      <div className="hero-stat">
        <span className="hero-label">{heroLabel}</span>
        <span className="hero-value">{overallAverage != null ? overallAverage.toFixed(1) : '—'}</span>
      </div>

      {handicappedAverage != null && (
        <div className="hero-stat hero-stat-secondary">
          <span className="hero-label">Handicapped Average (league games)</span>
          <span className="hero-value-secondary">{handicappedAverage.toFixed(1)}</span>
        </div>
      )}

      {averageDrift != null && (
        <div className="hero-stat hero-stat-secondary">
          <span className="hero-label">Average Drift ({driftShotCount} shot{driftShotCount === 1 ? '' : 's'})</span>
          <span className="hero-value-secondary">{formatDrift(averageDrift)}</span>
        </div>
      )}

      {rateStats && (
        <div className="rate-grid rate-grid-4">
          <RateTile label="Strike Rate" made={rateStats.strikes} opportunities={rateStats.strikeOpportunities} noun="first balls" />
          <RateTile label="Spare Conversion" made={rateStats.spares} opportunities={rateStats.spareOpportunities} noun="leaves" />
          <RateTile label="Split Rate" made={rateStats.splits} opportunities={rateStats.strikeOpportunities - rateStats.strikes} noun="leaves faced" />
          <RateTile label="Open Frames" made={rateStats.openFrames} opportunities={rateStats.completedFrames} noun="frames" />
        </div>
      )}

      {rateStats && <LeaveConversionTable data={leaveConversions} />}
      {rateStats && <PinLeaveDiagram data={pinLeaveStats} />}

      <LineChart title="Average Over Time" data={averageOverTime} />
      <BarChart title="Average by League" data={byLeague} unit="avg score" />
      <BarChart title="Average by Lane Condition" data={byLaneCondition} unit="avg score" />
      <BarChart title="Avg First-Ball Pinfall, by Ball" data={byBall} unit="pins" />
    </div>
  );
}
