import { useEffect, useMemo, useRef, useState } from 'react';
import PinDiagram from './PinDiagram';
import LanePicker, { type LanePickerHandle } from './LanePicker';
import { leaveName, suggestedApproachName } from '../lib/leaves';
import { markLabel, targetLabel } from '../lib/marks';

/** Parse a stored mark (text or numeric) into a board number for the picker. */
function toBoard(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Interpret a legacy 'arrow' target value as a board. Bowlers name arrows by
 *  the board they sit on (the 5th arrow is board 25), so a value over 7 is
 *  already a board; only a small arrow index (1-7) is scaled up (arrow N = board 5N). */
function arrowToBoard(v: string | number | null | undefined): number | null {
  const n = toBoard(v);
  if (n == null) return null;
  return n <= 7 ? n * 5 : n;
}

/** A reference approach's stored marks as picker board numbers. Mirrors the
 *  edit-seed logic (board straight through, legacy arrow via arrowToBoard). */
function approachBoards(a: Approach) {
  const target =
    a.reference_target_type === 'board'
      ? toBoard(a.reference_target_value)
      : a.reference_target_type === 'arrow'
        ? arrowToBoard(a.reference_target_value)
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
  leave: number[] | null;
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
  /** Saved reference to pre-select when logging a new shot (profile default
   *  strike approach, passed on fresh-rack balls); its marks seed the picker. */
  defaultApproachId?: string | null;
  /** Current score-entry mode, echoed back on submit so it persists across frames. */
  mode?: 'pick' | 'type';
  /** Optional detail fields the bowler has hidden (profiles.hidden_shot_fields).
   *  A hidden mark drops its LanePicker strip; a hidden field isn't rendered.
   *  Left empty when editing so no stored value is hidden (and thus wiped). */
  hiddenFields?: string[];
  /** When provided, submitting the form calls this with the form's FormData
   *  instead of posting natively (used by GameLogger to log a shot instantly
   *  client-side and sync in the background). Omitted everywhere else, where
   *  behavior is unchanged from a plain form POST. */
  onSubmit?: (data: FormData) => void;
  /** When provided (GameLogger only), "Save as Approach" enqueues onto the
   *  offline write queue instead of fetching directly -- applied optimistically
   *  by the caller. Absent on the drills/shot-editor pages, where it keeps its
   *  original plain-fetch behavior. */
  onSaveApproachOffline?: (write: {
    id: string;
    url: string;
    fields: Record<string, string>;
    optimisticApproach: Approach;
  }) => void;
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
  defaultApproachId,
  mode = 'pick',
  hiddenFields = [],
  onSubmit,
  onSaveApproachOffline,
}: Props) {
  const show = (key: string) => !hiddenFields.includes(key);
  const shownMarks = (['stance', 'target', 'slide', 'breakpoint'] as const).filter(show);
  // The profile default approach prefills a new shot: it starts selected and its
  // marks seed the picker below. Editing a shot ignores it (stored values win),
  // as does hiding the approach field.
  const defaultApproach =
    !initial && defaultApproachId && show('approach')
      ? (approaches.find((a) => a.id === defaultApproachId) ?? null)
      : null;
  const defaultBoards = defaultApproach ? approachBoards(defaultApproach) : null;
  const [approachId, setApproachId] = useState(initial?.approach_id ?? defaultApproach?.id ?? '');
  const [filterApproaches, setFilterApproaches] = useState(false);
  const laneRef = useRef<LanePickerHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // A persistent copy of the submit button pinned to the bottom of the screen
  // on mobile, so a long form (reference marks/hook/miss/note) doesn't force a
  // scroll to log the ball. Shown only while the real button is scrolled below
  // the viewport -- once it comes into view (or the page scrolls past it, e.g.
  // toward a drill's End Drill controls) the shortcut gets out of the way.
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const btn = submitRef.current;
    if (!btn || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry.isIntersecting && entry.boundingClientRect.top > 0),
      { threshold: 0 },
    );
    observer.observe(btn);
    return () => observer.disconnect();
  }, []);

  // "Save as Approach" posts in the background (fetch, not a real form submit)
  // so the page never reloads -- a native submit-and-redirect would land you
  // back on a fresh server render with the ball/references you'd just picked
  // gone (nothing seeds them back in for a not-yet-logged shot). This also
  // means it doesn't need to fight the game page's own fetch-based retry
  // interceptor, since that only listens for a real 'submit' event.
  type SaveApproachState =
    | { status: 'idle' | 'naming' | 'saving' | 'error' }
    | { status: 'saved'; id: string };
  const [saveApproach, setSaveApproach] = useState<SaveApproachState>({ status: 'idle' });
  const [approachName, setApproachName] = useState('');

  async function handleSaveApproach() {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    data.set('intent', 'save_as_approach');
    const name = approachName.trim();
    data.set('name', name);

    if (onSaveApproachOffline) {
      // Routed through the offline write queue (GameLogger only) -- applied
      // optimistically by the caller, so this never needs to wait on the
      // network to confirm "Saved" (usable by the match-filter on the very
      // next ball, per the locked offline plan).
      const id = crypto.randomUUID();
      data.set('id', id);
      const optimisticApproach: Approach = {
        id,
        name,
        reference_lineup: data.get('lineup_position')?.toString().trim() || null,
        reference_slide: data.get('slide_position')?.toString().trim() || null,
        reference_target_type: data.get('target_type')?.toString() || null,
        reference_target_value: (() => {
          const raw = data.get('target_value')?.toString().trim();
          return raw ? Number(raw) : null;
        })(),
        leave: standingPins,
      };
      onSaveApproachOffline({
        id,
        url: window.location.href,
        fields: Object.fromEntries(data.entries()) as Record<string, string>,
        optimisticApproach,
      });
      setSaveApproach({ status: 'saved', id });
      return;
    }

    setSaveApproach({ status: 'saving' });
    try {
      const res = await fetch(window.location.href, { method: 'POST', body: data, credentials: 'same-origin' });
      const id = res.ok ? new URL(res.url).searchParams.get('saved') : null;
      if (!id) throw new Error('save failed');
      setSaveApproach({ status: 'saved', id });
    } catch {
      setSaveApproach({ status: 'error' });
    }
  }

  const selectedApproach = useMemo(
    () => approaches.find((a) => a.id === approachId) ?? null,
    [approachId, approaches],
  );

  // Pins standing in front of this ball (the leave you're shooting at). Empty =
  // a fresh rack (the frame's first ball), where the filter instead means the
  // strike approaches (those with no leave).
  const standingPins = startingPins ?? [];
  const freshRack = standingPins.length === 0;

  // Optional approach filter. On a leave, keep approaches whose leave covers
  // every standing pin (leave ⊇ standing pins — same rule as the approaches
  // list filter). On a fresh rack, keep the strike approaches (empty leave).
  // The currently-selected approach is never hidden, so a manual pick isn't
  // silently dropped from the dropdown.
  const shownApproaches = useMemo(() => {
    if (!filterApproaches) return approaches;
    return approaches.filter(
      (a) =>
        a.id === approachId ||
        (freshRack ? (a.leave ?? []).length === 0 : standingPins.every((p) => (a.leave ?? []).includes(p))),
    );
  }, [filterApproaches, freshRack, approaches, approachId, standingPins]);

  // Which of the reference marks the picker is currently showing (stance/target/slide).
  const applicableMarks = shownMarks.filter((m) => m === 'stance' || m === 'target' || m === 'slide');

  // Copy a reference approach's marks into the LanePicker as a starting point
  // to adjust from. Runs when one is picked from the dropdown; only seeds the
  // marks currently shown. Picking "None" keeps whatever marks are placed.
  function applyReference(approach: Approach) {
    const b = approachBoards(approach);
    const seed: { stance?: number | null; target?: number | null; slide?: number | null } = {};
    if (applicableMarks.includes('stance')) seed.stance = b.stance;
    if (applicableMarks.includes('target')) seed.target = b.target;
    if (applicableMarks.includes('slide')) seed.slide = b.slide;
    laneRef.current?.apply(seed);
  }

  // seed the lane picker from an existing shot (an older 'arrow' target maps to
  // its board via arrowToBoard; a 'pin' target can't be placed), else from the
  // default approach's reference marks when one prefills this shot.
  const initialTarget =
    initial?.target_type === 'board'
      ? toBoard(initial.target_value)
      : initial?.target_type === 'arrow'
        ? arrowToBoard(initial.target_value)
        : (defaultBoards?.target ?? null);

  return (
    <form
      method="POST"
      ref={formRef}
      onSubmit={
        onSubmit
          ? (e) => {
              e.preventDefault();
              onSubmit(new FormData(e.currentTarget));
            }
          : undefined
      }
    >
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
        facedPins={standingPins}
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
            Saved References
            <select
              name="approach_id"
              value={approachId}
              onChange={(e) => {
                setApproachId(e.target.value);
                const picked = approaches.find((a) => a.id === e.target.value);
                if (picked) applyReference(picked);
              }}
            >
              <option value="">None</option>
              {shownApproaches.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          {approaches.length > 0 && (
            <label className="check match-pins">
              <input
                type="checkbox"
                checked={filterApproaches}
                onChange={(e) => setFilterApproaches(e.target.checked)}
              />
              {freshRack ? 'Only strike approaches' : `Match standing pins (${leaveName(standingPins)})`}
            </label>
          )}

          {selectedApproach && (
            <div className="reference-box">
              <strong>{selectedApproach.name} (reference)</strong>
              <span>Alignment (Starting Point): {markLabel(selectedApproach.reference_lineup) || '—'}</span>
              <span>
                Visual Target:{' '}
                {targetLabel(selectedApproach.reference_target_type, selectedApproach.reference_target_value) || '—'}
              </span>
              <span>Slide Position (Finish): {markLabel(selectedApproach.reference_slide) || '—'}</span>
            </div>
          )}
        </>
      )}

      {shownMarks.length > 0 && (
        <>
          <div className="sechead-mini"><span className="chev"><i></i><i></i><i></i></span><h3>Reference Marks</h3></div>
          <LanePicker
            ref={laneRef}
            initialLineup={toBoard(initial?.lineup_position) ?? defaultBoards?.stance}
            initialTarget={initialTarget}
            initialBreakpoint={toBoard(initial?.breakpoint_board)}
            initialSlide={toBoard(initial?.slide_position) ?? defaultBoards?.slide}
            marks={shownMarks}
          />
        </>
      )}

      {show('hook') && (
        <label>
          Hook Timing
          <select name="hook_timing" defaultValue={initial?.hook_timing ?? ''}>
            <option value="">None</option>
            <option value="early">Early</option>
            <option value="on-time">On-Time</option>
            <option value="late">Late</option>
            <option value="none">No Hook</option>
          </select>
        </label>
      )}

      {show('miss') && (
        <label>
          Miss Direction
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
          <textarea
            name="note"
            rows={2}
            defaultValue={initial?.note ?? ''}
            onFocus={(e) => {
              // the submit button sits right below; once the mobile keyboard
              // finishes animating in, re-center this field so the button
              // isn't left hidden underneath it
              const el = e.currentTarget;
              setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
            }}
          ></textarea>
        </label>
      )}

      <button type="submit" ref={submitRef}>{submitLabel}</button>
      {showSticky && (
        <div className="shot-sticky-submit">
          <button type="submit">{submitLabel}</button>
        </div>
      )}
      {saveApproach.status === 'idle' || saveApproach.status === 'error' ? (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setApproachName(suggestedApproachName(standingPins));
            setSaveApproach({ status: 'naming' });
          }}
        >
          Save as Approach
        </button>
      ) : saveApproach.status === 'naming' || saveApproach.status === 'saving' ? (
        <div className="reference-box save-approach-naming">
          <label>
            Approach Name
            <input
              type="text"
              value={approachName}
              onChange={(e) => setApproachName(e.target.value)}
              disabled={saveApproach.status === 'saving'}
            />
          </label>
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              disabled={saveApproach.status === 'saving' || !approachName.trim()}
              onClick={handleSaveApproach}
            >
              {saveApproach.status === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saveApproach.status === 'saving'}
              onClick={() => setSaveApproach({ status: 'idle' })}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {saveApproach.status === 'saved' && (
        <p className="empty">
          Saved as approach — <a href={`/approaches/${saveApproach.id}`}>View &amp; edit &rarr;</a>
        </p>
      )}
      {saveApproach.status === 'error' && <p className="error">Couldn't save the approach — try again.</p>}
    </form>
  );
}
