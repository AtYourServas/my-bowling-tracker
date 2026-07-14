// The optional approach-form fields a bowler can individually show or hide
// (profiles.hidden_approach_fields, PR 37). Name + Leave are core and always
// shown — Name is required and Leave drives the strike/spare + pin filters.
// The three "mark" keys line up with LanePicker's Mark names so a hidden mark
// drops its strip. Mirrors lib/shotFields.ts (the shot-logger equivalent).

export type ApproachFieldKey = 'ball' | 'stance' | 'target' | 'slide' | 'notes';

export const APPROACH_FIELDS: { key: ApproachFieldKey; label: string }[] = [
  { key: 'ball', label: 'Reference Ball' },
  { key: 'stance', label: 'Alignment (Starting Point)' },
  { key: 'target', label: 'Visual Target' },
  { key: 'slide', label: 'Slide Position (Finish)' },
  { key: 'notes', label: 'Notes' },
];

export const APPROACH_FIELD_KEYS: ApproachFieldKey[] = APPROACH_FIELDS.map((f) => f.key);

/** The approach-form mark keys that render as LanePicker strips (in strip order). */
export const APPROACH_MARK_FIELDS = ['stance', 'target', 'slide'] as const;
