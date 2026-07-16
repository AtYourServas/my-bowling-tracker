export const PIN_ROWS = [
  [7, 8, 9, 10],
  [4, 5, 6],
  [2, 3],
  [1],
];

const PIN_PATH =
  'M20,4 C27,4 27,14 24,20 C22,24 22,26 24,30 C30,38 33,58 30,76 C29,88 25,96 20,96 C15,96 11,88 10,76 C7,58 10,38 16,30 C18,26 18,24 16,20 C13,14 13,4 20,4 Z';

export function PinIcon({ n }: { n: number }) {
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

type PinRowsProps = {
  standing: Set<number>;
  onToggle: (pin: number) => void;
};

/** The 4-row, 10-pin grid shared by PinDiagram and LeavePicker. */
export function PinRows({ standing, onToggle }: PinRowsProps) {
  return (
    <div className="pin-rows">
      {PIN_ROWS.map((row, i) => (
        <div className="pin-row" key={i}>
          {row.map((pin) => (
            <button
              type="button"
              key={pin}
              className={`pin${standing.has(pin) ? ' standing' : ''}`}
              onClick={() => onToggle(pin)}
              aria-pressed={standing.has(pin)}
              aria-label={`Pin ${pin}${standing.has(pin) ? ', standing' : ''}`}
            >
              <PinIcon n={pin} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
