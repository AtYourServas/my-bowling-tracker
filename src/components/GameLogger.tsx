import { useEffect, useMemo, useRef, useState } from 'react';
import ShotForm from './ShotForm';
import {
  computeScoresheet,
  computeWarmupSheet,
  computeFrameRolls,
  frameProgress,
  allowedMarks,
  pinsStandingBefore,
  parseShotShorthand,
  WARMUP_FRAME,
  type ShotLite,
  type FrameLite,
  type FrameCell,
} from '../lib/scoring';
import { laneForFrame, hasLanePair, type LaneConfig } from '../lib/lanes';

/** Joins class names, skipping falsy values -- Astro's `class:list` isn't
 *  available in a plain React/TSX component, this is the local equivalent. */
function cx(...parts: Array<string | Record<string, boolean> | false | null | undefined>): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else for (const [k, v] of Object.entries(p)) if (v) out.push(k);
  }
  return out.join(' ');
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

export type ClientShotRow = {
  id: string;
  ball_id: string | null;
  approach_id: string | null;
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
  created_at: string;
  balls: { name: string } | null;
  /** Not yet confirmed by the server -- a client-generated placeholder id, no
   *  edit link rendered until a sync reconciles it with the real row. */
  pending?: boolean;
};

export type FrameRow = { frameNumber: number; shots: ClientShotRow[] };

type Sidebar = {
  scratchScore: number | null;
  sessionHandicap: number | null;
  canEndEarly: boolean;
  partialScore: { score: number; throughFrame: number } | null;
};

type Props = {
  sessionId: string;
  gameId: string;
  isWarmup: boolean;
  finalScore: number | null;
  frames: FrameRow[];
  initialFrameNumber: number;
  initialMode: 'pick' | 'type';
  balls: Ball[];
  approaches: Approach[];
  defaultBallId: string | null;
  defaultSpareBallId: string | null;
  defaultApproachId: string | null;
  hiddenShotFields: string[];
  laneConfig: LaneConfig;
  initialSidebar: Sidebar;
};

const ordinals = ['First', 'Second', 'Third'];
let tempIdCounter = 0;
const nextTempId = () => `temp-${Date.now()}-${tempIdCounter++}`;

/** A struck frame (1-9, or any warmup frame) shows the X alone in the
 *  top-right corner box -- drop the placeholder empty 2nd-ball square. */
function displayBalls(cell: FrameCell, isWarmup: boolean) {
  return (isWarmup || cell.frameNumber < 10) && cell.balls[0]?.kind === 'strike' ? cell.balls.slice(0, 1) : cell.balls;
}

function ballResult(shots: ClientShotRow[], frameMarks: FrameCell['balls'], knockedPerBall: number[], i: number): string {
  if (shots[i]?.foul) return 'Foul — counts 0';
  const kind = frameMarks[i]?.kind;
  if (kind === 'strike') return 'Strike';
  if (kind === 'spare') return 'Spare';
  const knocked = knockedPerBall[i] ?? 0;
  return knocked === 0 ? 'Gutter — 0 down' : `${knocked} down`;
}

export default function GameLogger({
  sessionId,
  gameId,
  isWarmup,
  finalScore,
  frames: initialFrames,
  initialFrameNumber,
  initialMode,
  balls,
  approaches,
  defaultBallId,
  defaultSpareBallId,
  defaultApproachId,
  hiddenShotFields,
  laneConfig,
  initialSidebar,
}: Props) {
  const [frames, setFrames] = useState<FrameRow[]>(initialFrames);
  const [activeFrame, setActiveFrame] = useState(initialFrameNumber);
  const [mode, setMode] = useState<'pick' | 'type'>(initialMode);
  const [sidebar, setSidebar] = useState<Sidebar>(initialSidebar);
  const [leaveNotesHtml, setLeaveNotesHtml] = useState('');
  const [shorthandValue, setShorthandValue] = useState('');
  const [shorthandError, setShorthandError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);

  type PendingSync = { frameNumber: number; formData: FormData };
  const [pendingSync, setPendingSync] = useState<PendingSync | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'retry'>('idle');

  const sheetWrapRef = useRef<HTMLDivElement>(null);
  const leaveNotesContainerRef = useRef<HTMLDivElement>(null);

  // Center the active frame in the horizontally-scrolling scoresheet whenever
  // it changes (on mount, on auto-advance, on a manual frame tap).
  useEffect(() => {
    const wrap = sheetWrapRef.current;
    const active = wrap?.querySelector('.cell.active');
    if (wrap instanceof HTMLElement && active instanceof HTMLElement) {
      const delta =
        active.getBoundingClientRect().left - wrap.getBoundingClientRect().left - (wrap.clientWidth - active.offsetWidth) / 2;
      wrap.scrollLeft += delta;
    }
  }, [activeFrame]);

  // A still-unsynced shot (in flight, or failed and awaiting retry) warns
  // before the tab closes -- once a sync confirms, there's nothing to lose.
  useEffect(() => {
    if (!pendingSync) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pendingSync]);

  // Keep the address bar's ?frame=&mode= in sync with client-side navigation
  // (no real reload) -- replaceState, not pushState, so auto-advancing
  // through a whole game doesn't pile up a back-button history entry per
  // shot. ShotForm's "Save as Approach" reads window.location.href directly
  // (unchanged, PR #79 background-fetch pattern), so this is load-bearing:
  // without it, that feature would silently save against a stale frame.
  useEffect(() => {
    const url = `/sessions/${sessionId}/games/${gameId}?frame=${activeFrame}&mode=${mode}`;
    window.history.replaceState(window.history.state, '', url);
  }, [sessionId, gameId, activeFrame, mode]);

  const ruleFrameNumber = isWarmup ? WARMUP_FRAME : activeFrame;

  const liteFrames: FrameLite[] = useMemo(
    () =>
      frames.map((f) => ({
        frame_number: f.frameNumber,
        shots: f.shots.map((s) => ({ pins_standing: s.pins_standing, strike: s.strike, spare: s.spare, foul: s.foul })),
      })),
    [frames],
  );

  const cells = useMemo(
    () => (isWarmup ? computeWarmupSheet(liteFrames, activeFrame) : computeScoresheet(liteFrames)),
    [liteFrames, isWarmup, activeFrame],
  );

  const activeFrameShots = useMemo(
    () => frames.find((f) => f.frameNumber === activeFrame)?.shots ?? [],
    [frames, activeFrame],
  );
  const activeFrameShotsLite: ShotLite[] = useMemo(
    () => activeFrameShots.map((s) => ({ pins_standing: s.pins_standing, strike: s.strike, spare: s.spare, foul: s.foul })),
    [activeFrameShots],
  );

  const progress = useMemo(() => frameProgress(ruleFrameNumber, activeFrameShotsLite), [ruleFrameNumber, activeFrameShotsLite]);
  const marks = useMemo(() => allowedMarks(ruleFrameNumber, activeFrameShotsLite), [ruleFrameNumber, activeFrameShotsLite]);
  const knockedPerBall = useMemo(() => computeFrameRolls(activeFrameShotsLite), [activeFrameShotsLite]);
  const frameMarksForActive = cells[activeFrame - 1]?.balls ?? [];

  const startingPins = activeFrameShots.length ? (activeFrameShots[activeFrameShots.length - 1].pins_standing ?? []) : [];

  const defaultBallIdForActive = progress.nextBall === 1 ? defaultBallId : (defaultSpareBallId ?? defaultBallId);
  const defaultApproachIdForActive = startingPins.length === 0 ? defaultApproachId : null;

  const strikeLockShot =
    (isWarmup || activeFrame < 10) && progress.complete && activeFrameShots.length === 1 ? activeFrameShots[0] : null;
  const nextFrameNumber = isWarmup ? activeFrame + 1 : activeFrame < 10 ? activeFrame + 1 : null;
  const activeBox = progress.nextBall != null ? progress.nextBall - 1 : -1;

  const frameLane = laneForFrame(activeFrame, laneConfig);
  const showFrameLane = hasLanePair(laneConfig) && frameLane != null;

  // --- background refresh (sidebar + leave notes) --------------------------

  async function refreshLeaveNotes(forFrame: number) {
    try {
      const res = await fetch(
        `/sessions/${sessionId}/games/${gameId}/leave-notes-fragment?frame=${forFrame}&warmup=${isWarmup ? '1' : '0'}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) return;
      const html = await res.text();
      setLeaveNotesHtml(html);
    } catch {
      // best-effort background refresh -- leave whatever was showing
    }
  }

  useEffect(() => {
    if (leaveNotesContainerRef.current) {
      leaveNotesContainerRef.current.innerHTML = leaveNotesHtml;
      // created_at is stored UTC; NoteCard's own localization script only runs
      // on a real page load, so redo it for anything just injected here.
      for (const el of leaveNotesContainerRef.current.querySelectorAll('time[data-note-time]')) {
        const iso = el.getAttribute('datetime');
        if (!iso) continue;
        const d = new Date(iso);
        if (!isNaN(d.getTime())) {
          el.textContent = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        }
      }
    }
  }, [leaveNotesHtml]);

  async function refreshSidebarAndFrame(loggedFrame: number, activeAfter: number) {
    try {
      const res = await fetch(`/sessions/${sessionId}/games/${gameId}/sidebar.json?frame=${loggedFrame}`, {
        credentials: 'same-origin',
      });
      if (res.ok) {
        const data = await res.json();
        setSidebar({
          scratchScore: data.scratchScore,
          sessionHandicap: data.sessionHandicap,
          canEndEarly: data.canEndEarly,
          partialScore: data.partialScore,
        });
        if (data.frameShots) {
          setFrames((prev) => {
            const next = prev.filter((f) => f.frameNumber !== loggedFrame);
            next.push({ frameNumber: loggedFrame, shots: data.frameShots });
            return next.sort((a, b) => a.frameNumber - b.frameNumber);
          });
        }
      }
    } catch {
      // the shot already synced (that's what triggered this call) -- a
      // failure here only means the sidebar/ids stay momentarily stale
    }
    void refreshLeaveNotes(activeAfter);
  }

  // Initial leave-notes paint (server already computed the peripheral data,
  // but not leaveNotesHtml -- fetch it once on mount).
  useEffect(() => {
    void refreshLeaveNotes(initialFrameNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- logging a shot --------------------------------------------------------

  function applyOptimisticShot(
    frameNumber: number,
    shot: { pins_standing: number[]; strike: boolean; spare: boolean; foul: boolean },
    extra: Partial<ClientShotRow> = {},
  ): number {
    const targetRow = frames.find((f) => f.frameNumber === frameNumber);
    const existingLite: ShotLite[] = (targetRow?.shots ?? []).map((s) => ({
      pins_standing: s.pins_standing,
      strike: s.strike,
      spare: s.spare,
      foul: s.foul,
    }));
    const after = frameProgress(isWarmup ? WARMUP_FRAME : frameNumber, [...existingLite, shot]);
    const target = after.complete && (isWarmup || frameNumber < 10) ? frameNumber + 1 : frameNumber;

    const newShot: ClientShotRow = {
      id: nextTempId(),
      ball_id: null,
      approach_id: null,
      lineup_position: null,
      slide_position: null,
      target_type: null,
      target_value: null,
      hook_timing: null,
      miss_direction: null,
      breakpoint_board: null,
      note: null,
      created_at: new Date().toISOString(),
      balls: null,
      pending: true,
      ...extra,
      ...shot,
    };

    setFrames((prev) => {
      const next = prev.map((f) => (f.frameNumber === frameNumber ? { ...f, shots: [...f.shots, newShot] } : f));
      if (!next.some((f) => f.frameNumber === frameNumber)) next.push({ frameNumber, shots: [newShot] });
      return next.sort((a, b) => a.frameNumber - b.frameNumber);
    });
    setActiveFrame(target);
    setEntryError(null);
    return target;
  }

  function rollbackOptimisticShot(frameNumber: number, revertActiveTo: number) {
    setFrames((prev) =>
      prev.map((f) => (f.frameNumber === frameNumber ? { ...f, shots: f.shots.filter((s) => !s.pending) } : f)),
    );
    setActiveFrame(revertActiveTo);
  }

  async function syncShot(loggedFrame: number, formData: FormData, activeAfter: number) {
    setSyncStatus('saving');
    formData.set('mode', mode);
    const url = `/sessions/${sessionId}/games/${gameId}?frame=${loggedFrame}&mode=${mode}`;
    let response: Response;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      response = await fetch(url, { method: 'POST', body: formData, credentials: 'same-origin', signal: ctrl.signal });
    } catch {
      setPendingSync({ frameNumber: loggedFrame, formData });
      setSyncStatus('retry');
      return;
    } finally {
      clearTimeout(timer);
    }

    if (response.redirected || response.ok) {
      // Server-side validation errors (e.g. a stale shot-cap mismatch) also
      // come back as response.ok without a redirect -- vanishingly rare here
      // since the entry surface only renders while the client's own
      // frameProgress agrees a ball is still expected, but roll back rather
      // than leave a shot the server never actually saved.
      if (!response.redirected) {
        rollbackOptimisticShot(loggedFrame, loggedFrame);
        setEntryError("That ball couldn't be saved -- the frame may already be complete. Refresh and try again.");
        setPendingSync(null);
        setSyncStatus('idle');
        return;
      }
      setPendingSync(null);
      setSyncStatus('idle');
      void refreshSidebarAndFrame(loggedFrame, activeAfter);
      return;
    }

    setPendingSync({ frameNumber: loggedFrame, formData });
    setSyncStatus('retry');
  }

  async function retrySync() {
    if (!pendingSync) return;
    await syncShot(pendingSync.frameNumber, pendingSync.formData, activeFrame);
  }

  function handlePickSubmit(formData: FormData) {
    const pinsRaw = formData.get('pins_standing')?.toString() ?? '';
    const pins_standing = pinsRaw
      ? pinsRaw
          .split(',')
          .map(Number)
          .filter((n) => n >= 1 && n <= 10)
      : [];
    const strike = formData.get('strike') === 'true';
    const spare = formData.get('spare') === 'true';
    const foul = formData.get('foul') === 'true';
    const ball_id = formData.get('ball_id')?.toString() || null;
    const ballName = balls.find((b) => b.id === ball_id)?.name ?? null;

    const loggedFrame = activeFrame;
    const targetFrame = applyOptimisticShot(
      loggedFrame,
      { pins_standing, strike, spare, foul },
      {
        ball_id,
        balls: ballName ? { name: ballName } : null,
        approach_id: formData.get('approach_id')?.toString() || null,
        lineup_position: formData.get('lineup_position')?.toString().trim() || null,
        slide_position: formData.get('slide_position')?.toString().trim() || null,
        target_type: formData.get('target_type')?.toString() || null,
        target_value: (() => {
          const raw = formData.get('target_value')?.toString().trim();
          return raw ? Number(raw) : null;
        })(),
        hook_timing: formData.get('hook_timing')?.toString() || null,
        miss_direction: formData.get('miss_direction')?.toString() || null,
        breakpoint_board: (() => {
          const raw = formData.get('breakpoint_board')?.toString().trim();
          return raw ? Number(raw) : null;
        })(),
        note: formData.get('note')?.toString().trim() || null,
      },
    );

    const syncData = new FormData();
    syncData.set('intent', 'log_shot');
    for (const key of [
      'pins_standing',
      'ball_id',
      'approach_id',
      'lineup_position',
      'slide_position',
      'target_type',
      'target_value',
      'strike',
      'spare',
      'foul',
      'hook_timing',
      'miss_direction',
      'breakpoint_board',
      'note',
    ]) {
      const v = formData.get(key);
      if (v != null) syncData.set(key, v as string);
    }
    void syncShot(loggedFrame, syncData, targetFrame);
  }

  function handleShorthandSubmit() {
    const raw = shorthandValue.trim() || 'G';
    const parsed = parseShotShorthand(raw, {
      priorStanding: pinsStandingBefore(activeFrameShotsLite),
      ballIndex: activeFrameShots.length,
      frameNumber: ruleFrameNumber,
    });

    if (!parsed.ok) {
      setShorthandError(parsed.error);
      return;
    }
    setShorthandError(null);
    setShorthandValue('');

    const ballIndex = activeFrameShots.length;
    const ball_id = ballIndex === 0 ? defaultBallId : (defaultSpareBallId ?? defaultBallId);
    const ballName = balls.find((b) => b.id === ball_id)?.name ?? null;

    const loggedFrame = activeFrame;
    const targetFrame = applyOptimisticShot(
      loggedFrame,
      {
        pins_standing: parsed.result.standing,
        strike: parsed.result.strike,
        spare: parsed.result.spare,
        foul: parsed.result.foul,
      },
      { ball_id, balls: ballName ? { name: ballName } : null },
    );

    const syncData = new FormData();
    syncData.set('intent', 'log_shorthand');
    syncData.set('shorthand', raw);
    void syncShot(loggedFrame, syncData, targetFrame);
  }

  function navigateToFrame(n: number) {
    if (n === activeFrame) return;
    setActiveFrame(n);
    void refreshLeaveNotes(n);
  }

  return (
    <>
      <div className="sechead">
        <span className="chev"><i></i><i></i><i></i></span>
        <h2>Scoresheet</h2>
      </div>

      <div className="entry-toggle" role="group" aria-label="Score entry mode">
        <button
          type="button"
          className={cx('seg', { active: mode === 'pick' })}
          aria-current={mode === 'pick' ? 'true' : undefined}
          onClick={() => setMode('pick')}
        >
          Pick Pins
        </button>
        <button
          type="button"
          className={cx('seg', { active: mode === 'type' })}
          aria-current={mode === 'type' ? 'true' : undefined}
          onClick={() => setMode('type')}
        >
          Type Score
        </button>
      </div>

      {mode === 'type' && progress.nextBall != null && (
        <div className="type-legend">
          <p className="type-instruction">Type into the highlighted frame, then press Enter.</p>
          <ul className="legend" aria-label="Shorthand key">
            <li><span className="k">X</span> strike</li>
            <li><span className="k">/</span> spare</li>
            <li><span className="k">G 0 -</span> gutter / miss</li>
            <li><span className="k">F</span> foul</li>
          </ul>
        </div>
      )}
      {shorthandError && <p className="error">{shorthandError}</p>}
      {entryError && <p className="error">{entryError}</p>}

      <div className="sheetwrap" ref={sheetWrapRef}>
        <div className="sheet" role="group" aria-label="Frames">
          {cells.map((cell) => {
            const isActive = cell.frameNumber === activeFrame;
            const typeHere = mode === 'type' && isActive && progress.nextBall != null;
            const cellClass = cx('cell', {
              active: isActive,
              future: !cell.bowled && !isActive,
              f10: !isWarmup && cell.frameNumber === 10,
            });
            return typeHere ? (
              <div
                className={cx(cellClass, 'typing')}
                key={cell.frameNumber}
                aria-current="true"
                aria-label={`Frame ${cell.frameNumber}, entering ball ${progress.nextBall}`}
              >
                <span className="fnum">{cell.frameNumber}</span>
                <span className="balls">
                  {cell.balls.map((b, i) =>
                    i === activeBox ? (
                      <input
                        key={i}
                        className="bbox bbox-input"
                        type="text"
                        value={shorthandValue}
                        maxLength={2}
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoFocus
                        aria-label={`Frame ${activeFrame}, ball ${progress.nextBall}`}
                        onChange={(e) => setShorthandValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleShorthandSubmit();
                          }
                        }}
                      />
                    ) : (
                      <span
                        key={i}
                        className={cx('bbox', {
                          mark: b.kind === 'strike' || b.kind === 'spare',
                          strike: b.kind === 'strike',
                          spare: b.kind === 'spare',
                          foul: b.kind === 'foul',
                          empty: b.kind === 'empty',
                        })}
                      >
                        {b.text}
                      </span>
                    ),
                  )}
                </span>
                <span className={cx('total', { blank: cell.cumulative == null })}>{cell.cumulative == null ? '—' : cell.cumulative}</span>
              </div>
            ) : (
              <button
                type="button"
                key={cell.frameNumber}
                className={cellClass}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`Frame ${cell.frameNumber}${cell.cumulative != null ? `, ${cell.cumulative}` : ''}`}
                onClick={() => navigateToFrame(cell.frameNumber)}
              >
                <span className="fnum">{cell.frameNumber}</span>
                <span className="balls">
                  {displayBalls(cell, isWarmup).map((b, i) => (
                    <span
                      key={i}
                      className={cx('bbox', {
                        mark: b.kind === 'strike' || b.kind === 'spare',
                        strike: b.kind === 'strike',
                        spare: b.kind === 'spare',
                        foul: b.kind === 'foul',
                        empty: b.kind === 'empty',
                      })}
                    >
                      {b.text}
                    </span>
                  ))}
                </span>
                <span className={cx('total', { blank: cell.cumulative == null })}>{cell.cumulative == null ? '—' : cell.cumulative}</span>
              </button>
            );
          })}
        </div>
      </div>
      {mode === 'type' && progress.nextBall != null && (
        <div className="type-controls">
          <button type="button" className="secondary" onClick={handleShorthandSubmit}>
            Log Ball {progress.nextBall}
          </button>
        </div>
      )}

      {!isWarmup && sidebar.scratchScore != null && sidebar.sessionHandicap != null && (
        <p className="hcap">
          + handicap {sidebar.sessionHandicap} = <b>{sidebar.scratchScore + sidebar.sessionHandicap}</b>
        </p>
      )}

      {!isWarmup && (
        <details className="setscore">
          <summary>{finalScore != null ? `Final Score · ${finalScore}` : 'Set Final Score'}</summary>
          <form className="finalscore" method="POST">
            <input type="hidden" name="intent" value="set_score" />
            <input type="hidden" name="mode" value={mode} />
            <input id="final_score" type="number" name="final_score" min="0" max="300" defaultValue={finalScore ?? ''} placeholder="&#8212;" aria-label="Final Score" />
            <button type="submit" className="secondary">Save</button>
          </form>
        </details>
      )}

      <div className="sechead">
        <span className="chev"><i></i><i></i><i></i></span>
        <h2>
          Now Bowling &middot; Frame {activeFrame}
          {progress.nextBall != null && ` · Ball ${progress.nextBall}`}
          {showFrameLane && ` · Lane ${frameLane}`}
        </h2>
      </div>

      {progress.nextBall != null ? (
        mode === 'pick' ? (
          <ShotForm
            balls={balls}
            approaches={approaches}
            frameNumber={activeFrame}
            startingPins={startingPins}
            allowStrike={marks.strike}
            allowSpare={marks.spare}
            defaultBallId={defaultBallIdForActive}
            defaultApproachId={defaultApproachIdForActive}
            mode={mode}
            hiddenFields={hiddenShotFields}
            submitLabel={`Log Ball ${progress.nextBall}`}
            onSubmit={handlePickSubmit}
          />
        ) : (
          <p className="logball">
            Type ball {progress.nextBall} into frame {activeFrame} above, then press Enter.
          </p>
        )
      ) : strikeLockShot ? (
        <p className="framedone">
          Strike &mdash; frame {activeFrame} complete. To add a second ball,{' '}
          {strikeLockShot.pending ? (
            'sync in progress…'
          ) : (
            <a href={`/sessions/${sessionId}/games/${gameId}/shots/${strikeLockShot.id}?mode=${mode}`}>edit the strike</a>
          )}{' '}
          first.
        </p>
      ) : (
        <p className="framedone">
          Frame {activeFrame} complete.{' '}
          {nextFrameNumber && (
            <button type="button" className="linklike" onClick={() => navigateToFrame(nextFrameNumber)}>
              Go to frame {nextFrameNumber} &rarr;
            </button>
          )}
        </p>
      )}

      <details className="game-note" id="note">
        <summary>+ Add a Note</summary>
        <form method="POST" className="add-note">
          <input type="hidden" name="intent" value="add_note" />
          <input type="hidden" name="mode" value={mode} />
          <textarea name="body" rows={2} placeholder="Quick thought while bowling — lane read, adjustment, reminder…" aria-label="New note" required></textarea>
          <button type="submit" className="secondary">Add Note</button>
        </form>
      </details>

      {activeFrameShots.length > 0 && (
        <ul className="ball-log">
          {activeFrameShots.map((shot, i) => (
            <li key={shot.id}>
              {shot.pending ? (
                <div className="ball-row">
                  <span className="ball-ord">{ordinals[i] ?? `Ball ${i + 1}`} ball</span>
                  <span className="ball-result">{ballResult(activeFrameShots, frameMarksForActive, knockedPerBall, i)}</span>
                  <span className="ball-detail">Syncing…</span>
                </div>
              ) : (
                <a className="ball-row" href={`/sessions/${sessionId}/games/${gameId}/shots/${shot.id}?mode=${mode}`}>
                  <span className="ball-ord">{ordinals[i] ?? `Ball ${i + 1}`} ball</span>
                  <span className="ball-result">{ballResult(activeFrameShots, frameMarksForActive, knockedPerBall, i)}</span>
                  <span className="ball-detail">
                    {[shot.balls?.name, shot.target_type && shot.target_value != null ? `${shot.target_type} ${shot.target_value}` : null, shot.hook_timing]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <div ref={leaveNotesContainerRef} />

      {syncStatus === 'retry' && (
        <div className="retry-banner" role="alert">
          <span className="retry-msg">Couldn't reach the server — your ball is held here. Retry when the connection's back.</span>
          <button type="button" className="secondary" onClick={() => void retrySync()}>
            Retry
          </button>
        </div>
      )}

      {sidebar.canEndEarly && sidebar.partialScore && (
        <form
          method="POST"
          className="row-actions"
          data-confirm={`End this game after frame ${sidebar.partialScore.throughFrame} with a score of ${sidebar.partialScore.score}? You can keep bowling later and re-save the score to correct it.`}
        >
          <input type="hidden" name="intent" value="end_practice_early" />
          <button type="submit" className="secondary end-action">
            End Game Here &middot; Score {sidebar.partialScore.score}
          </button>
        </form>
      )}
    </>
  );
}
