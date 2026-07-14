import { useState } from 'react';
import { leaveName, sortedLeave } from '../lib/leaves';

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
  /** Pins standing for this approach's leave (empty = strike / first-ball approach). */
  initialLeave?: number[];
  /** id of the Name input the suggestion chip fills. */
  nameFieldId?: string;
};

export default function LeavePicker({ initialLeave = [], nameFieldId = 'approach-name' }: Props) {
  const [standing, setStanding] = useState<Set<number>>(new Set(initialLeave));

  function togglePin(pin: number) {
    setStanding((prev) => {
      const next = new Set(prev);
      if (next.has(pin)) next.delete(pin);
      else next.add(pin);
      return next;
    });
  }

  function clearLeave() {
    setStanding(new Set());
  }

  const pins = sortedLeave(Array.from(standing));
  const suggestion = leaveName(pins);
  const isSpare = pins.length > 0;

  function applyName() {
    if (!suggestion) return;
    const el = document.getElementById(nameFieldId) as HTMLInputElement | null;
    if (el) el.value = suggestion;
  }

  return (
    <div>
      <input type="hidden" name="leave" value={pins.join(',')} />

      <div className="pin-shortcuts">
        {isSpare && (
          <button type="button" className="clear" onClick={clearLeave}>
            Clear (Strike Ball)
          </button>
        )}
        {suggestion && (
          <button type="button" className="name-suggest" onClick={applyName}>
            Use Name: {suggestion}
          </button>
        )}
      </div>

      <p className="pin-hint">
        {isSpare
          ? `Spare approach for the ${suggestion}`
          : 'No leave selected — a first-ball / strike approach. Highlight the pins this approach is for:'}
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
