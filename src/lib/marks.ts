// Display formatters for lane reference marks (stance / target / slide /
// breakpoint). These live in a mix of free-text and type+value columns and had
// been rendered ad-hoc across the notes stream, the shot-logger reference box,
// the approaches list, and the game review page — which let capitalization
// drift ("board 10" vs "Board 10"). Centralize the formatting here so every
// surface reads the same.

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// A stance / slide mark. Current data stores a bare board number ("10"); older
// free-text entries may already read "board 10". Normalize both to "Board 10".
// Anything non-numeric (arbitrary free text) is shown exactly as the user typed.
export function markLabel(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const stripped = raw.replace(/^board\s*/i, '').trim();
  return stripped !== '' && !Number.isNaN(Number(stripped)) ? `Board ${stripped}` : raw;
}

// A visual-target mark: a type ('board' | 'arrow' | 'pin') plus its value, e.g.
// "Board 10", "Arrow 5". Returns null when either half is missing.
export function targetLabel(
  type: string | null | undefined,
  value: number | string | null | undefined,
): string | null {
  if (!type || value == null || value === '') return null;
  return `${cap(type)} ${value}`;
}

// A breakpoint mark (always a numeric board).
export function breakpointLabel(value: number | string | null | undefined): string | null {
  return value == null || value === '' ? null : `Board ${value}`;
}
