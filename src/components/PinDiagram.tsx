import { useState } from 'react';
import { parseShotShorthand } from '../lib/scoring';

const PIN_ROWS = [
  [7, 8, 9, 10],
  [4, 5, 6],
  [2, 3],
  [1],
];

const PIN_PATH =
  'M20,4 C27,4 27,14 24,20 C22,24 22,26 24,30 C30,38 33,58 30,76 C29,88 25,96 20,96 C15,96 11,88 10,76 C7,58 10,38 16,30 C18,26 18,24 16,20 C13,14 13,4 20,4 Z';

function PinIcon({ n }: { n: number }) {
  return (
    <svg className="pin-svg" viewBox="0 0 40 100" aria-hidden="true">
      <path className="pin-body" d={PIN_PATH} />
      <rect className="pin-stripe" x="14" y="17" width="12" height="3" />
      <rect className="pin-stripe" x="13.5" y="22.5" width="13" height="3" />
      <text className="pin-num" x="20" y="64" textAnchor="middle" dominantBaseline="middle">
        {n}
      </text>
    </svg>
  );
}

type Props = {
  initialStanding?: number[];
  initialStrike?: boolean;
  initialSpare?: boolean;
  initialFoul?: boolean;
  /** Whether the Strike / Spare shortcuts are legal for this ball (see allowedMarks). */
  allowStrike?: boolean;
  allowSpare?: boolean;
  /** Pins this ball faces (10 = fresh rack); used to parse typed pin counts. */
  priorStanding?: number;
  /** 0-based ordinal of this ball within the frame; used to parse typed shorthand. */
  ballIndex?: number;
  frameNumber?: number;
};

export default function PinDiagram({
  initialStanding = [],
  initialStrike = false,
  initialSpare = false,
  initialFoul = false,
  allowStrike = true,
  allowSpare = true,
  priorStanding = 10,
  ballIndex = 0,
  frameNumber = 1,
}: Props) {
  const [standing, setStanding] = useState<Set<number>>(new Set(initialStanding));
  const [strike, setStrike] = useState(initialStrike);
  const [spare, setSpare] = useState(initialSpare);
  const [foul, setFoul] = useState(initialFoul);

  const [mode, setMode] = useState<'pick' | 'type'>('pick');
  const [typed, setTyped] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);

  function togglePin(pin: number) {
    setStrike(false);
    setSpare(false);
    setFoul(false);
    setStanding((prev) => {
      const next = new Set(prev);
      if (next.has(pin)) {
        next.delete(pin);
      } else {
        next.add(pin);
      }
      return next;
    });
  }

  function markStrike() {
    setStanding(new Set());
    setStrike(true);
    setSpare(false);
    setFoul(false);
  }

  function markSpare() {
    setStanding(new Set());
    setSpare(true);
    setStrike(false);
    setFoul(false);
  }

  function markGutter() {
    // gutter / miss on a fresh rack: nothing down, all ten still standing
    setStanding(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    setStrike(false);
    setSpare(false);
    setFoul(false);
  }

  function markFoul() {
    // a fouled delivery counts 0 regardless of pins; the rack respots for the next ball
    setStanding(new Set());
    setFoul(true);
    setStrike(false);
    setSpare(false);
  }

  const gutter = !strike && !spare && !foul && standing.size === 10;

  // show a mark only when it's legal for this ball, or already set (editing an
  // existing shot) so the current value is never hidden
  const showStrike = allowStrike || strike;
  const showSpare = allowSpare || spare;

  // A short human summary of exactly what will be logged, derived from the
  // canonical state (not the typed text) so it is always the truth of submit.
  const knocked = priorStanding - standing.size;
  const resultLabel = foul
    ? 'Foul — this ball counts 0'
    : strike
      ? 'Strike'
      : spare
        ? 'Spare'
        : knocked <= 0
          ? `Gutter — 0 down, ${priorStanding} standing`
          : `${knocked} down${standing.size ? `, ${standing.size} standing` : ''}`;

  // Best-effort shorthand for the current state, to seed the type field when you
  // switch into type mode (so the two entry modes stay in sync).
  function currentShorthand(): string {
    if (foul) return 'F';
    if (strike) return 'X';
    if (spare) return '/';
    if (knocked <= 0) return '-';
    if (standing.size === 0) return ''; // cleared but unflagged; let them retype
    return String(knocked);
  }

  function applyParsed(value: string) {
    setTyped(value);
    if (value.trim() === '') {
      setTypeError(null);
      return;
    }
    const parsed = parseShotShorthand(value, { priorStanding, ballIndex, frameNumber });
    if (!parsed.ok) {
      setTypeError(parsed.error);
      return;
    }
    setTypeError(null);
    setStanding(new Set(parsed.result.standing));
    setStrike(parsed.result.strike);
    setSpare(parsed.result.spare);
    setFoul(parsed.result.foul);
  }

  function switchMode(next: 'pick' | 'type') {
    if (next === mode) return;
    if (next === 'type') {
      setTyped(currentShorthand());
      setTypeError(null);
    }
    setMode(next);
  }

  return (
    <div>
      <input type="hidden" name="pins_standing" value={Array.from(standing).join(',')} />
      <input type="hidden" name="strike" value={strike ? 'true' : 'false'} />
      <input type="hidden" name="spare" value={spare ? 'true' : 'false'} />
      <input type="hidden" name="foul" value={foul ? 'true' : 'false'} />

      <div className="entry-toggle" role="group" aria-label="Shot entry mode">
        <button type="button" className={mode === 'pick' ? 'active' : ''} aria-pressed={mode === 'pick'} onClick={() => switchMode('pick')}>
          Pick pins
        </button>
        <button type="button" className={mode === 'type' ? 'active' : ''} aria-pressed={mode === 'type'} onClick={() => switchMode('type')}>
          Type result
        </button>
      </div>

      {mode === 'pick' ? (
        <>
          <div className="pin-shortcuts">
            {showStrike && (
              <button type="button" className={strike ? 'active' : ''} onClick={markStrike}>
                Strike
              </button>
            )}
            {showSpare && (
              <button type="button" className={spare ? 'active' : ''} onClick={markSpare}>
                Spare
              </button>
            )}
            <button type="button" className={gutter ? 'active' : ''} onClick={markGutter}>
              Gutter
            </button>
            <button type="button" className={foul ? 'active' : ''} onClick={markFoul}>
              Foul
            </button>
          </div>

          <p className="pin-hint">
            {strike
              ? 'Strike marked'
              : spare
                ? 'Spare marked'
                : foul
                  ? 'Foul — this ball counts 0'
                  : gutter
                    ? 'Gutter — 0 pins down'
                    : 'Or highlight the pins still standing:'}
          </p>

          <div className="pin-rows">
            {PIN_ROWS.map((row, i) => (
              <div className="pin-row" key={i}>
                {row.map((pin) => (
                  <button
                    type="button"
                    key={pin}
                    className={`pin${standing.has(pin) ? ' standing' : ''}`}
                    onClick={() => togglePin(pin)}
                    aria-pressed={standing.has(pin)}
                    aria-label={`Pin ${pin}${standing.has(pin) ? ', standing' : ''}`}
                  >
                    <PinIcon n={pin} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="type-entry">
          <label className="type-field">
            <span>Shorthand</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. X · 7 · / · F · G"
              value={typed}
              onChange={(e) => applyParsed(e.target.value)}
              aria-invalid={typeError ? 'true' : undefined}
            />
          </label>
          {typeError ? (
            <p className="type-error">{typeError}</p>
          ) : (
            <p className="type-preview" aria-live="polite">{resultLabel}</p>
          )}
          <p className="type-help">
            X strike · / spare · number = pins down · F foul · G gutter
          </p>
        </div>
      )}
    </div>
  );
}
