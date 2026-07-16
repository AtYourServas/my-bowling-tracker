import { useState } from 'react';
import { leaveName, sortedLeave } from '../lib/leaves';
import { PinRows } from './PinRack';

type Props = {
  /** Pins standing for this approach's leave (empty = strike / first-ball approach). */
  initialLeave?: number[];
  /** id of the Name input the suggestion chip fills (approach variant only). */
  nameFieldId?: string;
  /** Hidden input field name that carries the selected pins. */
  fieldName?: string;
  /** 'approach' = setup form (name chip, strike wording); 'filter' = list filter. */
  variant?: 'approach' | 'filter';
};

export default function LeavePicker({
  initialLeave = [],
  nameFieldId = 'approach-name',
  fieldName = 'leave',
  variant = 'approach',
}: Props) {
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
  const hasPins = pins.length > 0;
  const isApproach = variant === 'approach';

  function applyName() {
    if (!suggestion) return;
    const el = document.getElementById(nameFieldId) as HTMLInputElement | null;
    if (el) el.value = suggestion;
  }

  return (
    <div>
      <input type="hidden" name={fieldName} value={pins.join(',')} />

      <div className="pin-shortcuts">
        {hasPins && (
          <button type="button" className="clear" onClick={clearLeave}>
            {isApproach ? 'Clear (Strike Ball)' : 'Clear'}
          </button>
        )}
        {isApproach && suggestion && (
          <button type="button" className="name-suggest" onClick={applyName}>
            Use Name: {suggestion}
          </button>
        )}
      </div>

      <p className="pin-hint">
        {isApproach
          ? hasPins
            ? `Spare approach for the ${suggestion}`
            : 'No leave selected — a first-ball / strike approach. Highlight the pins this approach is for:'
          : 'Highlight pins to show approaches whose leave includes them:'}
      </p>

      <PinRows standing={standing} onToggle={togglePin} />
    </div>
  );
}
