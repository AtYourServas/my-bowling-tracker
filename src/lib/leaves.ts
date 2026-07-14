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
