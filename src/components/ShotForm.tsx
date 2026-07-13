import { useMemo, useRef, useState } from 'react';
import PinDiagram from './PinDiagram';
import LanePicker, { type LanePickerHandle } from './LanePicker';

/** Parse a stored mark (text or numeric) into a board number for the picker. */
function toBoard(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A reference approach's stored marks as picker board numbers. Mirrors the
 *  edit-seed logic: an older 'arrow' target maps to its board (arrow N = board 5N). */
function approachBoards(a: Approach) {
  const target =
    a.reference_target_type === 'board'
      ? toBoard(a.reference_target_value)
      : a.reference_target_type === 'arrow'
        ? toBoard(a.reference_target_value != null ? a.reference_target_value * 5 : null)
        : null;
  return {
    stance: toBoard(a.reference_lineup),
    target,
    slide: toBoard(a.reference_slide),
  };
}

type Ball = { id: string; name: string };
type Approach = {
  id: string;
  name: string;
  reference_lineup: string | null;
  reference_slide: string | null;
  reference_target_type: string | null;
  reference_target_value: number | null;
};

type InitialShot = {
  approach_id: string | null;
  ball_id: string | null;
  lineup_position: string | null;
  slide_position: string | null;
  target_type: string | null;
  target_value: number | null;
  pins_standing: number[];
  strike: boolean;
  spare: boolean;
  foul: boolean;
  hook_timing: string | null;
  miss_direction: string | null;
  breakpoint_board: number | null;
  note: string | null;
};

type Props = {
  balls: Ball[];
  approaches: Approach[];
  frameNumber: number;
  initial?: InitialShot;
  submitLabel?: string;
  /** Pins already standing at the start of this roll (e.g. the leftovers from ball 1),
   *  pre-highlighted so you only clear the ones this ball knocks down. */
  startingPins?: number[];
  /** Whether the Strike / Spare shortcuts are legal for this ball (see allowedMarks). */
  allowStrike?: boolean;
  allowSpare?: boolean;
  /** Ball to pre-select when logging a new shot (session default / spare ball). */
  defaultBallId?: string | null;
  /** Current score-entry mode, echoed back on submit so it persists across frames. */
  mode?: 'pick' | 'type';
  /** Optional detail fields the bowler has hidden (profiles.hidden_shot_fields).
   *  A hidden mark drops its LanePicker strip; a hidden field isn't rendered.
   *  Left empty when editing so no stored value is hidden (and thus wiped). */
  hiddenFields?: string[];
};

export default function ShotForm({
  balls,
  approaches,
  frameNumber,
  initial,
  submitLabel = 'Log shot',
  startingPins,
  allowStrike = true,
  allowSpare = true,
  defaultBallId,
  mode = 'pick',
  hiddenFields = [],
}: Props) {
  const show = (key: string) => !hiddenFields.includes(key);
  const shownMarks = (['stance', 'target', 'slide', 'breakpoint'] as const).filter(show);
  const [approachId, setApproachId] = useState(initial?.approach_id ?? '');
  const [applied, setApplied] = useState(false);
  const laneRef = useRef<LanePickerHandle>(null);

  const selectedApproach = useMemo(
    () => approaches.find((a) => a.id === approachId) ?? null,
    [approachId, approaches],
  );

  // Which of the reference marks the picker is currently showing (stance/target/slide).
  const applicableMarks = shownMarks.filter((m) => m === 'stance' || m === 'target' || m === 'slide');

  // Copy the selected reference approach's marks into the LanePicker as a
  // starting point to adjust from. Only seeds the marks currently shown.
  function applyReference() {
    if (!selectedApproach) return;
    const b = approachBoards(selectedApproach);
    const seed: { stance?: number | null; target?: number | null; slide?: number | null } = {};
    if (applicableMarks.includes('stance')) seed.stance = b.stance;
    if (applicableMarks.includes('target')) seed.target = b.target;
    if (applicableMarks.includes('slide')) seed.slide = b.slide;
    laneRef.current?.apply(seed);
    setApplied(true);
  }

  // seed the lane picker from an existing shot. An older 'arrow' target maps to
  // its board (arrow N sits on board 5N); a 'pin' target can't be placed.
  const initialTarget =
    initial?.target_type === 'board'
      ? toBoard(initial.target_value)
      : initial?.target_type === 'arrow'
        ? toBoard(initial.target_value != null ? initial.target_value * 5 : null)
        : null;

  return (
    <form method="POST">
      <input type="hidden" name="frame_number" value={frameNumber} />
      <input type="hidden" name="intent" value="log_shot" />
      <input type="hidden" name="mode" value={mode} />

      <PinDiagram
        initialStanding={initial?.pins_standing ?? startingPins ?? []}
        initialStrike={initial?.strike ?? false}
        initialSpare={initial?.spare ?? false}
        initialFoul={initial?.foul ?? false}
        allowStrike={allowStrike}
        allowSpare={allowSpare}
      />

      <label>
        Ball
        <select name="ball_id" defaultValue={initial?.ball_id ?? defaultBallId ?? ''}>
          <option value="">None</option>
          {balls.map((ball) => (
            <option key={ball.id} value={ball.id}>
              {ball.name}
            </option>
          ))}
        </select>
      </label>

      {show('approach') && (
        <>
          <label>
            Reference approach
            <select
              name="approach_id"
              value={approachId}
              onChange={(e) => {
                setApproachId(e.target.value);
                setApplied(false);
              }}
            >
              <option value="">None</option>
              {approaches.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          {selectedApproach && (
            <div className="reference-box">
              <strong>{selectedApproach.name} (reference)</strong>
              <span>Lineup: {selectedApproach.reference_lineup || '—'}</span>
              <span>Slide: {selectedApproach.reference_slide || '—'}</span>
              <span>
                Target:{' '}
                {selectedApproach.reference_target_type && selectedApproach.reference_target_value != null
                  ? `${selectedApproach.reference_target_type} ${selectedApproach.reference_target_value}`
                  : '—'}
              </span>
              {applicableMarks.length > 0 && (
                <button type="button" className="apply-approach" onClick={applyReference}>
                  {applied ? '✓ Applied to my approach' : 'Apply to my approach'}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {shownMarks.length > 0 && (
        <>
          <div className="sechead-mini"><span className="chev"><i></i><i></i><i></i></span><h3>Reference marks</h3></div>
          <LanePicker
            ref={laneRef}
            initialLineup={toBoard(initial?.lineup_position)}
            initialTarget={initialTarget}
            initialBreakpoint={toBoard(initial?.breakpoint_board)}
            initialSlide={toBoard(initial?.slide_position)}
            marks={shownMarks}
          />
        </>
      )}

      {show('hook') && (
        <label>
          Hook timing
          <select name="hook_timing" defaultValue={initial?.hook_timing ?? ''}>
            <option value="">None</option>
            <option value="early">Early</option>
            <option value="on-time">On-time</option>
            <option value="late">Late</option>
            <option value="none">No hook</option>
          </select>
        </label>
      )}

      {show('miss') && (
        <label>
          Miss direction
          <select name="miss_direction" defaultValue={initial?.miss_direction ?? ''}>
            <option value="">None</option>
            <option value="high">High</option>
            <option value="low">Low</option>
            <option value="flush">Flush</option>
            <option value="pocket">Pocket</option>
          </select>
        </label>
      )}

      {show('note') && (
        <label>
          Note
          <textarea name="note" rows={2} defaultValue={initial?.note ?? ''}></textarea>
        </label>
      )}

      <button type="submit">{submitLabel}</button>
    </form>
  );
}
