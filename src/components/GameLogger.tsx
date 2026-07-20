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
  earliestIncompleteFrame,
  earliestIncompleteWarmupFrame,
  WARMUP_FRAME,
  type ShotLite,
  type FrameLite,
  type FrameCell,
} from '../lib/scoring';
import { laneForFrame, hasLanePair, type LaneConfig } from '../lib/lanes';
import { enqueueWrite, listQueuedWrites, removeQueuedWrite, cacheReferenceData, type QueuedWrite } from '../lib/offlineQueue';

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
  approaches: initialApproaches,
  defaultBallId,
  defaultSpareBallId,
  defaultApproachId,
  hiddenShotFields,
  laneConfig,
  initialSidebar,
}: Props) {
  const [frames, setFrames] = useState<FrameRow[]>(initialFrames);
  const [approaches, setApproaches] = useState<Approach[]>(initialApproaches);
  const [activeFrame, setActiveFrame] = useState(initialFrameNumber);
  const [mode, setMode] = useState<'pick' | 'type'>(initialMode);
  const [sidebar, setSidebar] = useState<Sidebar>(initialSidebar);
  const [leaveNotesHtml, setLeaveNotesHtml] = useState('');
  const [shorthandValue, setShorthandValue] = useState('');
  const [shorthandError, setShorthandError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);

  // The offline write queue (IndexedDB-backed, src/lib/offlineQueue.ts) --
  // `queuedCount` mirrors how many writes are waiting so the retry banner and
  // beforeunload guard can key off it. `flushingRef` prevents two overlapping
  // flush loops (e.g. an 'online' event firing while a manual Retry click is
  // already mid-flight).
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'retry' | 'failed'>('idle');
  const flushingRef = useRef(false);

  // The head-of-queue write that hit a real server error (not a connectivity
  // problem -- see the 'http-error' vs 'network' split in sendQueuedWrite
  // below), plus whether its Discard action is in its confirm step.
  const [failedWrite, setFailedWrite] = useState<{
    id: string;
    kind: QueuedWrite['kind'];
    frameNumber?: number;
    message: string;
  } | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // A 'saving' flush usually resolves near-instantly (the common online
  // single-shot case) -- only show the syncing indicator if it's still going
  // after a short debounce, so it doesn't flicker on every ball logged.
  const [showSyncing, setShowSyncing] = useState(false);
  useEffect(() => {
    if (syncStatus !== 'saving') {
      setShowSyncing(false);
      return;
    }
    const timer = setTimeout(() => setShowSyncing(true), 500);
    return () => clearTimeout(timer);
  }, [syncStatus]);

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

  // A still-unsynced write (in flight, or failed and awaiting retry) warns
  // before the tab closes -- once the queue drains, there's nothing to lose.
  // (Not the only safety net: queued writes also survive a reload via
  // IndexedDB + the mount-time rehydration effect below.)
  useEffect(() => {
    if (queuedCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [queuedCount]);

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

  // --- reference-data caching (write-only in Phase 2 -- Phase 3's service
  // worker is what will read this back for an offline page-load) -----------
  useEffect(() => {
    void cacheReferenceData('balls', balls);
    void cacheReferenceData('profileDefaults', { defaultBallId, defaultSpareBallId, defaultApproachId, hiddenShotFields });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- offline write queue ----------------------------------------------------
  // Every logged shot/saved approach is persisted to IndexedDB (src/lib/
  // offlineQueue.ts) before it's ever sent, so a reload -- even mid-offline --
  // never loses it (unlike Phase 1, where a not-yet-synced shot lived only in
  // React state). Writes for one game are replayed strictly in order, one at
  // a time: this is also what fixes Phase 1's other real gap, where rapid
  // consecutive shots could have multiple syncs in flight with no ordering
  // guarantee at all.

  const url = `/sessions/${sessionId}/games/${gameId}?frame=${activeFrame}&mode=${mode}`;

  type SendResult =
    | { status: 'ok' }
    | { status: 'rejected'; message: string }
    | { status: 'network' }
    | { status: 'http-error'; message: string };

  // Rolls back a write's optimistic entry (used both when the server
  // declines it outright and when the user explicitly discards a
  // permanently-failed one) -- one shared branch for both write kinds
  // instead of duplicating the shot/approach split at each call site.
  function rollbackOptimisticWrite(kind: QueuedWrite['kind'], id: string, frameNumber?: number) {
    if (kind === 'save_as_approach') {
      setApproaches((prev) => prev.filter((a) => a.id !== id));
    } else {
      setFrames((prev) =>
        prev.map((f) => (f.frameNumber === frameNumber ? { ...f, shots: f.shots.filter((s) => s.id !== id) } : f)),
      );
    }
  }

  async function sendQueuedWrite(write: QueuedWrite): Promise<SendResult> {
    const body = new FormData();
    for (const [k, v] of Object.entries(write.fields)) body.set(k, v);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(write.url, { method: 'POST', body, credentials: 'same-origin', signal: ctrl.signal });
    } catch {
      return { status: 'network' };
    } finally {
      clearTimeout(timer);
    }
    if (response.redirected) return { status: 'ok' };
    if (response.ok) {
      // Server-side validation errors (e.g. a stale shot-cap mismatch) also
      // come back as response.ok without a redirect -- vanishingly rare here
      // since the entry surface only renders while the client's own
      // frameProgress agrees a ball is still expected.
      return {
        status: 'rejected',
        message:
          write.kind === 'save_as_approach'
            ? "That approach couldn't be saved. Try again."
            : "That ball couldn't be saved -- the frame may already be complete. Refresh and try again.",
      };
    }
    // A real HTTP error status (4xx/5xx) -- the request reached the server
    // and got a definite answer, so unlike a network failure this won't fix
    // itself just because connectivity returns.
    return {
      status: 'http-error',
      message:
        write.kind === 'save_as_approach'
          ? "That approach couldn't be saved (server error)."
          : "That ball couldn't be saved (server error).",
    };
  }

  // Processes this game's queue oldest-first, one write at a time, stopping
  // (and leaving the rest queued) at the first network/server failure. Always
  // re-lists from IndexedDB rather than trusting a possibly-stale in-memory
  // copy, so it's safe to call from a listener registered once on mount.
  async function runFlush() {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setSyncStatus('saving');

    for (;;) {
      const queued = await listQueuedWrites(gameId);
      setQueuedCount(queued.length);
      if (queued.length === 0) break;
      const next = queued[0];
      const result = await sendQueuedWrite(next);

      if (result.status === 'network') {
        setSyncStatus('retry');
        flushingRef.current = false;
        return;
      }

      if (result.status === 'http-error') {
        // Not a connectivity problem -- reconnecting won't fix this on its
        // own, so it gets its own banner (Retry / Discard) instead of the
        // generic "waiting for the connection" one, and isn't picked up by
        // the 'online' auto-retry listener below.
        setSyncStatus('failed');
        setFailedWrite({
          id: next.id,
          kind: next.kind,
          frameNumber: next.kind === 'save_as_approach' ? undefined : next.frameNumber,
          message: result.message,
        });
        flushingRef.current = false;
        return;
      }

      await removeQueuedWrite(next.id);

      if (result.status === 'rejected') {
        rollbackOptimisticWrite(next.kind, next.id, next.kind === 'save_as_approach' ? undefined : next.frameNumber);
        setEntryError(result.message);
        continue;
      }

      // ok
      if (next.kind === 'save_as_approach') {
        // already applied optimistically when it was enqueued -- nothing else to reconcile
      } else {
        setFrames((prev) =>
          prev.map((f) =>
            f.frameNumber === next.frameNumber
              ? { ...f, shots: f.shots.map((s) => (s.id === next.id ? { ...s, pending: false } : s)) }
              : f,
          ),
        );
        // Awaited, not fire-and-forget: this replaces frame `next.frameNumber`'s
        // whole shots array with the server's current snapshot (see
        // refreshSidebarAndFrame above). Two overlapping calls for the same
        // frame -- e.g. one per queued shot when catching up a multi-shot
        // backlog -- would race, and the slower/older one can resolve last
        // and clobber the newer snapshot. Awaiting keeps the queue's
        // one-at-a-time ordering guarantee intact through the refresh too.
        await refreshSidebarAndFrame(next.frameNumber, activeFrame);
      }
    }

    setSyncStatus('idle');
    flushingRef.current = false;
  }

  // Actions for the Sync Failed banner (http-error only -- see runFlush).
  function retryFailedWrite() {
    setFailedWrite(null);
    setConfirmingDiscard(false);
    void runFlush();
  }

  async function discardFailedWrite() {
    if (!failedWrite) return;
    await removeQueuedWrite(failedWrite.id);
    rollbackOptimisticWrite(failedWrite.kind, failedWrite.id, failedWrite.frameNumber);
    setFailedWrite(null);
    setConfirmingDiscard(false);
    setSyncStatus('idle');
    void runFlush(); // resume anything queued behind it
  }

  // Auto-retry the instant connectivity returns, rather than leaving queued
  // writes waiting on someone to notice the retry banner and tap it. Matters
  // most on mobile at the alley, where beforeunload confirmation dialogs (the
  // other safety net, above) are notoriously unreliable. Skipped for a
  // 'failed' (http-error) write -- reconnecting doesn't change a server's
  // answer, so re-attempting it needs the user's explicit Retry, not a
  // silent auto-retry on the next connectivity blip.
  const syncStatusRef = useRef(syncStatus);
  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);
  useEffect(() => {
    const onOnline = () => {
      if (syncStatusRef.current === 'failed') return;
      void runFlush();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount-time rehydration (fixes the Phase 1 "shots lost on refresh while
  // offline" gap): any write still queued from before this reload gets its
  // optimistic row re-injected into state -- unless it turns out to already
  // be present in the server-rendered initial props, meaning it actually
  // landed and only the client never got the ack, in which case the stale
  // queue entry is just dropped.
  useEffect(() => {
    (async () => {
      const queued = await listQueuedWrites(gameId);
      if (queued.length === 0) return;

      let mergedFrames = initialFrames;
      let mergedApproaches = initialApproaches;
      const staleIds: string[] = [];

      for (const w of queued) {
        if (w.kind === 'save_as_approach') {
          const approach = w.optimisticApproach as Approach;
          if (mergedApproaches.some((a) => a.id === approach.id)) {
            staleIds.push(w.id);
            continue;
          }
          mergedApproaches = [...mergedApproaches, approach];
        } else {
          const shot = w.optimisticShot as ClientShotRow;
          if (mergedFrames.some((f) => f.shots.some((s) => s.id === shot.id))) {
            staleIds.push(w.id);
            continue;
          }
          const frameExists = mergedFrames.some((f) => f.frameNumber === w.frameNumber);
          mergedFrames = frameExists
            ? mergedFrames.map((f) => (f.frameNumber === w.frameNumber ? { ...f, shots: [...f.shots, shot] } : f))
            : [...mergedFrames, { frameNumber: w.frameNumber, shots: [shot] }].sort((a, b) => a.frameNumber - b.frameNumber);
        }
      }

      for (const id of staleIds) await removeQueuedWrite(id);

      setFrames(mergedFrames);
      setApproaches(mergedApproaches);

      const rehydratedLite: FrameLite[] = mergedFrames.map((f) => ({
        frame_number: f.frameNumber,
        shots: f.shots.map((s) => ({ pins_standing: s.pins_standing, strike: s.strike, spare: s.spare, foul: s.foul })),
      }));
      setActiveFrame(isWarmup ? earliestIncompleteWarmupFrame(rehydratedLite) : earliestIncompleteFrame(rehydratedLite));

      void runFlush();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- logging a shot --------------------------------------------------------

  function applyOptimisticShot(
    frameNumber: number,
    shot: { pins_standing: number[]; strike: boolean; spare: boolean; foul: boolean },
    extra: Partial<ClientShotRow> = {},
  ): ClientShotRow {
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
      id: crypto.randomUUID(),
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
    // A real page reload used to put the bowler back at the top for free on
    // every logged ball; now that logging one is a client-side update with
    // no navigation, do the same explicitly -- otherwise they're left
    // scrolled down at wherever the entry form was (often well below the
    // scoresheet on a long form with reference marks) after every shot.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return newShot;
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
    const id = crypto.randomUUID();
    const optimisticShot = applyOptimisticShot(
      loggedFrame,
      { pins_standing, strike, spare, foul },
      {
        id,
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

    const fields: Record<string, string> = { intent: 'log_shot', id, mode };
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
      if (v != null) fields[key] = v as string;
    }
    void enqueueWrite({
      id,
      kind: 'log_shot',
      gameId,
      frameNumber: loggedFrame,
      url,
      fields,
      optimisticShot,
      createdAt: Date.now(),
    }).then(() => void runFlush());
  }

  // On-screen shorthand keypad (Type Score mode) -- keeps X/·/− within thumb
  // reach on mobile instead of hunting for symbols on the OS keyboard, which
  // `inputMode="none"` on the box above discourages from popping up at all.
  // Digits append (respecting the 2-char max, e.g. "10"); a mark token always
  // replaces whatever was typed, since none of X/·/− can combine with digits.
  function tapShorthandDigit(digit: string) {
    setShorthandValue((prev) => (prev + digit).slice(0, 2));
    setShorthandError(null);
  }
  function tapShorthandToken(token: string) {
    setShorthandValue(token);
    setShorthandError(null);
  }
  function tapShorthandBackspace() {
    setShorthandValue((prev) => prev.slice(0, -1));
    setShorthandError(null);
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
    const id = crypto.randomUUID();
    const optimisticShot = applyOptimisticShot(
      loggedFrame,
      {
        pins_standing: parsed.result.standing,
        strike: parsed.result.strike,
        spare: parsed.result.spare,
        foul: parsed.result.foul,
      },
      { id, ball_id, balls: ballName ? { name: ballName } : null },
    );

    const fields: Record<string, string> = { intent: 'log_shorthand', id, mode, shorthand: raw };
    void enqueueWrite({
      id,
      kind: 'log_shorthand',
      gameId,
      frameNumber: loggedFrame,
      url,
      fields,
      optimisticShot,
      createdAt: Date.now(),
    }).then(() => void runFlush());
  }

  // Wired to ShotForm's "Save as Approach" (only from this game-page
  // embedding -- drills/shot-editor pages don't pass this prop, so their
  // ShotForm keeps its original plain-fetch behavior). Applied optimistically
  // (added to `approaches` + cached) immediately, per the locked plan: usable
  // by the match-filter on the very next ball, before it's even synced.
  function handleSaveApproachOffline(write: { id: string; url: string; fields: Record<string, string>; optimisticApproach: Approach }) {
    setApproaches((prev) => {
      const next = [...prev, write.optimisticApproach];
      void cacheReferenceData('approaches', next);
      return next;
    });
    void enqueueWrite({
      id: write.id,
      kind: 'save_as_approach',
      gameId,
      url: write.url,
      fields: write.fields,
      optimisticApproach: write.optimisticApproach,
      createdAt: Date.now(),
    }).then(() => void runFlush());
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
                        inputMode="none"
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
        <div className="shorthand-keypad" role="group" aria-label="Shorthand keypad">
          {['1', '2', '3', 'X', '4', '5', '6', '/', '7', '8', '9', '-'].map((k) => (
            <button
              key={k}
              type="button"
              className={cx('key', { mark: k === 'X' || k === '/' || k === '-' })}
              onClick={() => (['X', '/', '-'].includes(k) ? tapShorthandToken(k) : tapShorthandDigit(k))}
            >
              {k}
            </button>
          ))}
          <button type="button" className="key log-ball" onClick={() => handleShorthandSubmit()}>
            Log Ball {progress.nextBall}
          </button>
          <button
            type="button"
            className="key backspace"
            aria-label="Backspace"
            disabled={shorthandValue === ''}
            onClick={tapShorthandBackspace}
          >
            &larr;
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
          <form className="finalscore" method="POST" data-astro-reload>
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
            // Each logical ball needs a FRESH ShotForm/PinDiagram instance --
            // without a changing key, React reuses the same mounted instance
            // across shots now that logging one no longer reloads the page,
            // so PinDiagram's internal strike/spare/foul state (and every
            // defaultValue-seeded select) would otherwise carry over into
            // the next ball instead of resetting.
            key={`${activeFrame}-${progress.nextBall}-${activeFrameShots.length}`}
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
            onSaveApproachOffline={handleSaveApproachOffline}
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
        <form method="POST" className="add-note" data-astro-reload>
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
          <span className="retry-msg">
            Couldn't reach the server — {queuedCount} {queuedCount === 1 ? 'item' : 'items'} waiting to sync. Retry when
            the connection's back.
          </span>
          <button type="button" className="secondary" onClick={() => void runFlush()}>
            Retry
          </button>
        </div>
      )}

      {syncStatus === 'failed' && failedWrite && (
        <div className="retry-banner failed" role="alert">
          {confirmingDiscard ? (
            <>
              <span className="retry-msg">
                Discard this {failedWrite.kind === 'save_as_approach' ? 'approach' : 'shot'}? It won't be saved.
              </span>
              <button type="button" className="secondary" onClick={() => setConfirmingDiscard(false)}>
                Cancel
              </button>
              <button type="button" className="danger" onClick={() => void discardFailedWrite()}>
                Confirm Discard
              </button>
            </>
          ) : (
            <>
              <span className="retry-msg">{failedWrite.message}</span>
              <button type="button" className="secondary" onClick={retryFailedWrite}>
                Retry
              </button>
              <button type="button" className="danger" onClick={() => setConfirmingDiscard(true)}>
                Discard {failedWrite.kind === 'save_as_approach' ? 'Approach' : 'Shot'}
              </button>
            </>
          )}
        </div>
      )}

      {showSyncing && syncStatus === 'saving' && (
        <div className="retry-banner syncing" role="status">
          <span className="retry-msg">Syncing{queuedCount > 1 ? ` ${queuedCount} pending shots` : ''}…</span>
        </div>
      )}

      {sidebar.canEndEarly && sidebar.partialScore && (
        <form
          method="POST"
          className="row-actions"
          data-confirm={`End this game after frame ${sidebar.partialScore.throughFrame} with a score of ${sidebar.partialScore.score}? You can keep bowling later and re-save the score to correct it.`}
          data-astro-reload
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
