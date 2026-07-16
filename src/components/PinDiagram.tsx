import { useState } from 'react';

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

const FULL_RACK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Placeholder preference for count-based entry, matching type mode's
// canonicalStanding: the back pins stand in until the real ones are tapped.
const CANON_ORDER = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

type Props = {
  initialStanding?: number[];
  initialStrike?: boolean;
  initialSpare?: boolean;
  initialFoul?: boolean;
  /** Whether the Strike / Spare shortcuts are legal for this ball (see allowedMarks). */
  allowStrike?: boolean;
  allowSpare?: boolean;
  /** Pins standing BEFORE this ball (the leave it faces); a full rack when omitted.
   *  Drives the missed-everything shortcut and the quick-count buttons. */
  facedPins?: number[];
};

export default function PinDiagram({
  initialStanding = [],
  initialStrike = false,
  initialSpare = false,
  initialFoul = false,
  allowStrike = true,
  allowSpare = true,
  facedPins,
}: Props) {
  const [standing, setStanding] = useState<Set<number>>(new Set(initialStanding));
  const [strike, setStrike] = useState(initialStrike);
  const [spare, setSpare] = useState(initialSpare);
  const [foul, setFoul] = useState(initialFoul);

  const faced = facedPins && facedPins.length > 0 ? facedPins : FULL_RACK;
  const freshRack = faced.length === 10;

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
    // gutter / missed everything: nothing down, the faced leave still stands
    // (all ten on a fresh rack — never MORE pins than this ball faced)
    setStanding(new Set(faced));
    setStrike(false);
    setSpare(false);
    setFoul(false);
  }

  function markCount(down: number) {
    // count-based quick entry: how many fell, with placeholder identities from
    // within the faced leave (back pins stand in, like type mode); tap pins
    // afterwards to correct which ones actually stand
    const keep = CANON_ORDER.filter((p) => faced.includes(p)).slice(0, faced.length - down);
    setStanding(new Set(keep));
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

  function markClear() {
    // reset back to the pristine, nothing-selected state
    setStanding(new Set());
    setStrike(false);
    setSpare(false);
    setFoul(false);
  }

  const noMark = !strike && !spare && !foul;
  const gutter = noMark && standing.size === faced.length && faced.every((p) => standing.has(p));
  const dirty = strike || spare || foul || standing.size > 0;

  // The implied "N down" of the current pin state (also lights the matching
  // count button); only meaningful while standing ⊆ the faced leave.
  const downCount =
    noMark && standing.size > 0 && [...standing].every((p) => faced.includes(p))
      ? faced.length - standing.size
      : null;
  // 1 .. n-1 pins down; 0 = Gutter/Missed, all n = Strike/Spare
  const counts = Array.from({ length: faced.length - 1 }, (_, i) => i + 1);

  // show a mark only when it's legal for this ball, or already set (editing an
  // existing shot) so the current value is never hidden
  const showStrike = allowStrike || strike;
  const showSpare = allowSpare || spare;

  return (
    <div>
      <input type="hidden" name="pins_standing" value={Array.from(standing).join(',')} />
      <input type="hidden" name="strike" value={strike ? 'true' : 'false'} />
      <input type="hidden" name="spare" value={spare ? 'true' : 'false'} />
      <input type="hidden" name="foul" value={foul ? 'true' : 'false'} />

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
          {freshRack ? 'Gutter' : 'Missed'}
        </button>
        <button type="button" className={foul ? 'active' : ''} onClick={markFoul}>
          Foul
        </button>
        {dirty && (
          <button type="button" className="clear" onClick={markClear}>
            Clear
          </button>
        )}
      </div>

      {counts.length > 0 && (
        <div className="pin-counts" role="group" aria-label="Quick count, pins down">
          <span className="pin-counts-label">Pins Down:</span>
          {counts.map((c) => (
            <button
              type="button"
              key={c}
              className={downCount === c ? 'active' : ''}
              onClick={() => markCount(c)}
              aria-label={`${c} pin${c === 1 ? '' : 's'} down`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <p className="pin-hint">
        {strike
          ? 'Strike marked'
          : spare
            ? 'Spare marked'
            : foul
              ? 'Foul — this ball counts 0'
              : gutter
                ? `${freshRack ? 'Gutter' : 'Missed everything'} — 0 pins down`
                : downCount != null
                  ? `${downCount} down — tap pins to fix which are standing:`
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
    </div>
  );
}
