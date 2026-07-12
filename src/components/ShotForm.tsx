import { useMemo, useState } from 'react';
import PinDiagram from './PinDiagram';

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
}: Props) {
  const [approachId, setApproachId] = useState(initial?.approach_id ?? '');

  const selectedApproach = useMemo(
    () => approaches.find((a) => a.id === approachId) ?? null,
    [approachId, approaches],
  );

  return (
    <form method="POST">
      <input type="hidden" name="frame_number" value={frameNumber} />
      <input type="hidden" name="intent" value="log_shot" />

      <PinDiagram
        initialStanding={initial?.pins_standing ?? startingPins ?? []}
        initialStrike={initial?.strike ?? false}
        initialSpare={initial?.spare ?? false}
        initialFoul={initial?.foul ?? false}
        allowStrike={allowStrike}
        allowSpare={allowSpare}
      />

      <label>
        Reference approach
        <select name="approach_id" value={approachId} onChange={(e) => setApproachId(e.target.value)}>
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
        </div>
      )}

      <label>
        Ball
        <select name="ball_id" defaultValue={initial?.ball_id ?? ''}>
          <option value="">None</option>
          {balls.map((ball) => (
            <option key={ball.id} value={ball.id}>
              {ball.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Lineup / stance position
        <input type="text" name="lineup_position" defaultValue={initial?.lineup_position ?? ''} />
      </label>

      <label>
        Slide position
        <input type="text" name="slide_position" defaultValue={initial?.slide_position ?? ''} />
      </label>

      <div className="target-row">
        <label>
          Target type
          <select name="target_type" defaultValue={initial?.target_type ?? ''}>
            <option value="">None</option>
            <option value="board">Board</option>
            <option value="arrow">Arrow</option>
            <option value="pin">Pin</option>
          </select>
        </label>
        <label>
          Target value
          <input type="number" name="target_value" defaultValue={initial?.target_value ?? ''} />
        </label>
      </div>

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

      <label>
        Breakpoint board
        <input type="number" name="breakpoint_board" defaultValue={initial?.breakpoint_board ?? ''} />
      </label>

      <label>
        Note
        <textarea name="note" rows={2} defaultValue={initial?.note ?? ''}></textarea>
      </label>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}
