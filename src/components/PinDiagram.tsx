import { useState } from 'react';

const PIN_ROWS = [
  [7, 8, 9, 10],
  [4, 5, 6],
  [2, 3],
  [1],
];

type Props = {
  initialStanding?: number[];
  initialStrike?: boolean;
  initialSpare?: boolean;
};

export default function PinDiagram({ initialStanding = [], initialStrike = false, initialSpare = false }: Props) {
  const [standing, setStanding] = useState<Set<number>>(new Set(initialStanding));
  const [strike, setStrike] = useState(initialStrike);
  const [spare, setSpare] = useState(initialSpare);

  function togglePin(pin: number) {
    setStrike(false);
    setSpare(false);
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
  }

  function markSpare() {
    setStanding(new Set());
    setSpare(true);
    setStrike(false);
  }

  return (
    <div>
      <input type="hidden" name="pins_standing" value={Array.from(standing).join(',')} />
      <input type="hidden" name="strike" value={strike ? 'true' : 'false'} />
      <input type="hidden" name="spare" value={spare ? 'true' : 'false'} />

      <div className="pin-shortcuts">
        <button type="button" className={strike ? 'active' : ''} onClick={markStrike}>
          Strike
        </button>
        <button type="button" className={spare ? 'active' : ''} onClick={markSpare}>
          Spare
        </button>
      </div>

      <p className="pin-hint">
        {strike ? 'Strike marked' : spare ? 'Spare marked' : 'Or tap the pins still standing:'}
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
              >
                {pin}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
