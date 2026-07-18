export const PIN_ROWS = [
  [7, 8, 9, 10],
  [4, 5, 6],
  [2, 3],
  [1],
];

export function PinIcon({ n }: { n: number }) {
  return (
    <svg className="pin-svg" viewBox="0 0 40 40" aria-hidden="true">
      <circle className="pin-body" cx="20" cy="20" r="18" />
      <text className="pin-num" x="20" y="20" textAnchor="middle" dominantBaseline="middle">
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
