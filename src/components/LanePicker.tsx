import { useRef, useState } from 'react';

/**
 * Visual reference-mark picker, modelled on the reference app's lane strips.
 * One horizontal lane strip per mark; tap the strip (or nudge with the arrows)
 * to place a marker at a board. Boards run 1-39 with board 1 on the right and
 * board 20 the centre (right-hander convention); positions snap to the half
 * board (e.g. 23.5) to match how bowlers call their marks.
 *
 * The three marks feed existing shot columns:
 *   Stance     → lineup_position  (text)
 *   Target     → target_type='board' + target_value  (numeric)
 *   Breakpoint → breakpoint_board  (numeric)
 * Slide / hook / miss / note stay as their own fields in ShotForm.
 */

const BOARDS = 39;
const ARROW_BOARDS = [5, 10, 15, 20, 25, 30, 35];
const STEP = 0.5;

// strip geometry (SVG user units)
const SW = 200;
const SH = 40;
const PAD = 5;
const LANE_LEFT = PAD;
const LANE_RIGHT = SW - PAD;
const LANE_W = LANE_RIGHT - LANE_LEFT;
const BW = LANE_W / BOARDS;

type Mark = 'stance' | 'target' | 'breakpoint' | 'slide';

// rendered top-to-bottom: where you start, where you aim, where you finish,
// where the ball breaks.
const ORDER: Mark[] = ['stance', 'target', 'slide', 'breakpoint'];

const META: Record<Mark, { label: string; arrows: boolean; dots: boolean }> = {
  stance: { label: 'Stance', arrows: false, dots: true },
  target: { label: 'Target', arrows: true, dots: false },
  breakpoint: { label: 'Breakpoint', arrows: false, dots: false },
  slide: { label: 'Slide', arrows: false, dots: true },
};

function xForBoard(b: number): number {
  return LANE_RIGHT - (b - 0.5) * BW;
}

function clampBoard(b: number): number {
  return Math.min(BOARDS, Math.max(1, b));
}

function snap(b: number): number {
  return clampBoard(Math.round(b / STEP) * STEP);
}

function boardForX(x: number): number {
  return snap((LANE_RIGHT - x) / BW + 0.5);
}

function arrowNumber(board: number): number | null {
  const i = ARROW_BOARDS.indexOf(board);
  return i === -1 ? null : i + 1;
}

function ordinal(n: number): string {
  return ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][n - 1] ?? `${n}th`;
}

function fmt(v: number): string {
  return v.toFixed(1);
}

function LaneStrip({
  mark,
  value,
  onPlace,
  onNudge,
  onClear,
}: {
  mark: Mark;
  value: number | null;
  onPlace: (board: number) => void;
  onNudge: (delta: number) => void;
  onClear: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const meta = META[mark];

  function place(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    onPlace(boardForX(p.x));
  }

  const mx = value != null ? xForBoard(value) : null;
  const arrow = value != null && meta.arrows ? arrowNumber(value) : null;
  const detail = value == null
    ? '—'
    : value === 20
      ? `${fmt(value)} · center`
      : arrow
        ? `${fmt(value)} · ${ordinal(arrow)} arrow`
        : fmt(value);

  return (
    <div className={`lane-strip lane-strip-${mark}`}>
      <div className="lane-strip-head">
        <span className="lane-swatch" aria-hidden="true" />
        <span className="lane-strip-label">{meta.label}</span>
        <span className="lane-strip-value">{detail}</span>
        {value != null && (
          <button type="button" className="lane-clear" onClick={onClear} aria-label={`Clear ${meta.label}`}>
            Clear
          </button>
        )}
      </div>
      <div className="lane-strip-body">
        <button
          type="button"
          className="lane-nudge"
          onClick={() => onNudge(+STEP)}
          aria-label={`Move ${meta.label} left one half board`}
        >
          &#9664;
        </button>
        <svg
          ref={svgRef}
          className="lane-svg"
          viewBox={`0 0 ${SW} ${SH}`}
          role="img"
          aria-label={`${meta.label} lane strip${value != null ? `, board ${fmt(value)}` : ', not set'}`}
          onPointerDown={place}
        >
          <rect className="lane-bed" x={0} y={2} width={SW} height={SH - 4} rx={3} />

          {/* board grain */}
          {Array.from({ length: BOARDS - 1 }, (_, i) => i + 1).map((i) => (
            <line
              key={`g-${i}`}
              className="lane-board"
              x1={LANE_LEFT + i * BW}
              y1={3}
              x2={LANE_LEFT + i * BW}
              y2={SH - 3}
            />
          ))}
          <line className="lane-board lane-board-center" x1={xForBoard(20)} y1={3} x2={xForBoard(20)} y2={SH - 3} />

          {/* aiming arrows (target strip) */}
          {meta.arrows &&
            ARROW_BOARDS.map((b) => {
              const x = xForBoard(b);
              return <polygon key={`a-${b}`} className="lane-arrow" points={`${x},7 ${x - 3.5},16 ${x + 3.5},16`} />;
            })}

          {/* approach dots (stance strip) */}
          {meta.dots &&
            ARROW_BOARDS.map((b) => <circle key={`d-${b}`} className="lane-dot" cx={xForBoard(b)} cy={SH / 2} r={1.8} />)}

          {/* placed marker: pentagon pointing up the lane */}
          {mx != null && (
            <polygon
              className="lane-mark"
              points={`${mx},9 ${mx + 7},18 ${mx + 4.5},31 ${mx - 4.5},31 ${mx - 7},18`}
            />
          )}
        </svg>
        <button
          type="button"
          className="lane-nudge"
          onClick={() => onNudge(-STEP)}
          aria-label={`Move ${meta.label} right one half board`}
        >
          &#9654;
        </button>
      </div>
    </div>
  );
}

/** Hidden-input field names the picker posts. Defaults target the `shots` table;
 *  pass overrides (e.g. the approaches `reference_*` columns) to reuse the picker
 *  on another form. */
type FieldNames = {
  lineup: string;
  targetType: string;
  targetValue: string;
  breakpoint: string;
  slide: string;
};

const SHOT_NAMES: FieldNames = {
  lineup: 'lineup_position',
  targetType: 'target_type',
  targetValue: 'target_value',
  breakpoint: 'breakpoint_board',
  slide: 'slide_position',
};

type Props = {
  initialLineup?: number | null;
  initialTarget?: number | null;
  initialBreakpoint?: number | null;
  initialSlide?: number | null;
  /** Override the hidden-input field names (defaults to the shot columns). */
  names?: Partial<FieldNames>;
  /** Which marks to render + post. Defaults to all four; approaches omit breakpoint. */
  marks?: Mark[];
};

export default function LanePicker({
  initialLineup,
  initialTarget,
  initialBreakpoint,
  initialSlide,
  names,
  marks = ORDER,
}: Props) {
  const [stance, setStance] = useState<number | null>(initialLineup ?? null);
  const [target, setTarget] = useState<number | null>(initialTarget ?? null);
  const [breakpoint, setBreakpoint] = useState<number | null>(initialBreakpoint ?? null);
  const [slide, setSlide] = useState<number | null>(initialSlide ?? null);

  const field = { ...SHOT_NAMES, ...names };
  const shown = ORDER.filter((m) => marks.includes(m));

  const state: Record<Mark, [number | null, (v: number | null) => void]> = {
    stance: [stance, setStance],
    target: [target, setTarget],
    breakpoint: [breakpoint, setBreakpoint],
    slide: [slide, setSlide],
  };

  // drift = how far the slide foot finishes from the stance (positive = toward
  // board 1 / the right for a right-hander).
  const drift =
    shown.includes('stance') && shown.includes('slide') && stance != null && slide != null
      ? stance - slide
      : null;

  return (
    <div className="lane-picker">
      {shown.includes('stance') && (
        <input type="hidden" name={field.lineup} value={stance != null ? String(stance) : ''} />
      )}
      {shown.includes('target') && (
        <>
          <input type="hidden" name={field.targetType} value={target != null ? 'board' : ''} />
          <input type="hidden" name={field.targetValue} value={target != null ? String(target) : ''} />
        </>
      )}
      {shown.includes('breakpoint') && (
        <input type="hidden" name={field.breakpoint} value={breakpoint != null ? String(breakpoint) : ''} />
      )}
      {shown.includes('slide') && (
        <input type="hidden" name={field.slide} value={slide != null ? String(slide) : ''} />
      )}

      <p className="lane-hint">Tap a strip or use the arrows to set each mark. Board 1 is on the right, 20 is center.</p>

      {shown.map((mark) => {
        const [value, setValue] = state[mark];
        return (
          <LaneStrip
            key={mark}
            mark={mark}
            value={value}
            onPlace={(board) => setValue(board)}
            onNudge={(delta) => setValue(snap((value ?? 20) + delta))}
            onClear={() => setValue(null)}
          />
        );
      })}

      {drift != null && (
        <p className="lane-drift">
          Drift
          <b>{drift === 0 ? 'none' : `${fmt(Math.abs(drift))} ${drift > 0 ? 'right' : 'left'}`}</b>
          <span>(stance {fmt(stance!)} → slide {fmt(slide!)})</span>
        </p>
      )}
    </div>
  );
}
