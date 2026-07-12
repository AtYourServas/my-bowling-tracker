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

type Props = {
  initialStanding?: number[];
  initialStrike?: boolean;
  initialSpare?: boolean;
  initialFoul?: boolean;
};

export default function PinDiagram({
  initialStanding = [],
  initialStrike = false,
  initialSpare = false,
  initialFoul = false,
}: Props) {
  const [standing, setStanding] = useState<Set<number>>(new Set(initialStanding));
  const [strike, setStrike] = useState(initialStrike);
  const [spare, setSpare] = useState(initialSpare);
  const [foul, setFoul] = useState(initialFoul);

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

  return (
    <div>
      <input type="hidden" name="pins_standing" value={Array.from(standing).join(',')} />
      <input type="hidden" name="strike" value={strike ? 'true' : 'false'} />
      <input type="hidden" name="spare" value={spare ? 'true' : 'false'} />
      <input type="hidden" name="foul" value={foul ? 'true' : 'false'} />

      <div className="pin-shortcuts">
        <button type="button" className={strike ? 'active' : ''} onClick={markStrike}>
          Strike
        </button>
        <button type="button" className={spare ? 'active' : ''} onClick={markSpare}>
          Spare
        </button>
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
    </div>
  );
}
