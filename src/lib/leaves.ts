// Helpers for pin leaves stored on approaches (approaches.leave = pins standing).

// A curated set of well-known named leaves, keyed by the sorted pins joined
// with '-'. Only widely-accepted names are included; anything else falls back
// to the plain pin list.
const NAMED_LEAVES: Record<string, string> = {
  '7-10': '7-10 Split',
  '4-6': '4-6 Split',
  '8-10': '8-10 Split',
  '7-9': '7-9 Split',
  '2-7': '2-7 Baby Split',
  '3-10': '3-10 Baby Split',
  '5-7': '5-7 Split',
  '5-10': '5-10 Split',
  '4-6-7-10': 'Big Four',
  '4-6-7-9-10': 'Greek Church',
  '4-6-7-8-10': 'Greek Church',
  '1-2-4-10': 'Washout',
  '1-3-6-7': 'Washout',
};

export function sortedLeave(pins: number[]): number[] {
  return [...pins].sort((a, b) => a - b);
}

// Physical pin-deck adjacency: two pins a ball can knock down together in one
// pass (same-row neighbors + the diagonals between rows).
const ADJACENT_PINS: Record<number, number[]> = {
  1: [2, 3],
  2: [1, 3, 4, 5],
  3: [1, 2, 5, 6],
  4: [2, 5, 7, 8],
  5: [2, 3, 4, 6, 8, 9],
  6: [3, 5, 9, 10],
  7: [4, 8],
  8: [4, 5, 7, 9],
  9: [5, 6, 8, 10],
  10: [6, 9],
};

/**
 * A split: the head pin (1) is down, at least two pins remain standing, and
 * they aren't all reachable from one another through adjacent standing pins
 * (i.e. a downed pin has separated them so one ball can't carry both). Works
 * for any leave, not just the curated NAMED_LEAVES.
 */
export function isSplit(standingPins: number[]): boolean {
  const pins = new Set(standingPins);
  if (pins.has(1) || pins.size < 2) return false;

  const remaining = new Set(pins);
  const start = standingPins[0];
  remaining.delete(start);
  const stack = [start];
  while (stack.length > 0) {
    const pin = stack.pop() as number;
    for (const neighbor of ADJACENT_PINS[pin] ?? []) {
      if (remaining.has(neighbor)) {
        remaining.delete(neighbor);
        stack.push(neighbor);
      }
    }
  }
  return remaining.size > 0;
}

// A spare approach targets a specific leave; an empty leave is a first-ball /
// strike approach.
export function isSpareLeave(pins: number[] | null | undefined): boolean {
  return (pins?.length ?? 0) > 0;
}

// Suggested name for a leave: "10 Pin" for a single pin, a known split name if
// we have one, otherwise the dash-joined pins ("3-6-10").
export function leaveName(pins: number[]): string {
  const s = sortedLeave(pins);
  if (s.length === 0) return '';
  if (s.length === 1) return `${s[0]} Pin`;
  const key = s.join('-');
  return NAMED_LEAVES[key] ?? key;
}

// Short label for cards: "Strike ball" for no leave, else "Spare · <name>".
export function leaveLabel(pins: number[] | null | undefined): string {
  if (!isSpareLeave(pins)) return 'Strike ball';
  return `Spare · ${leaveName(pins as number[])}`;
}

// Display name for a set of standing pins, treating a full 10 as "Full Rack"
// (used where a fresh rack is a valid "faced" state, e.g. a first-ball note).
export function leaveDisplayName(pins: number[]): string {
  return pins.length === 10 ? 'Full Rack' : leaveName(pins);
}
