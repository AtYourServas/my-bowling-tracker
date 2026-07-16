import { useState } from 'react';
import { PinRows } from './PinRack';

const FULL_RACK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type Props = {
  initialStanding?: number[];
  initialStrike?: boolean;
  initialSpare?: boolean;
  initialFoul?: boolean;
  /** Whether the Strike / Spare shortcuts are legal for this ball (see allowedMarks). */
  allowStrike?: boolean;
  allowSpare?: boolean;
  /** Pins standing BEFORE this ball (the leave it faces); a full rack when omitted.
   *  Drives the missed-everything shortcut. */
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

  const gutter =
    !strike && !spare && !foul && standing.size === faced.length && faced.every((p) => standing.has(p));
  const dirty = strike || spare || foul || standing.size > 0;

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

      <p className="pin-hint">
        {strike
          ? 'Strike marked'
          : spare
            ? 'Spare marked'
            : foul
              ? 'Foul — this ball counts 0'
              : gutter
                ? `${freshRack ? 'Gutter' : 'Missed everything'} — 0 pins down`
                : 'Or highlight the pins still standing:'}
      </p>

      <PinRows standing={standing} onToggle={togglePin} />
    </div>
  );
}
