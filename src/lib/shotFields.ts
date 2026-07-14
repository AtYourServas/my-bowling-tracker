// The optional shot-logger detail fields a bowler can individually show or hide
// (profiles.hidden_shot_fields, PR 19). Pins + strike/spare + Ball are core and
// always shown; everything below is toggleable from /settings. The four "mark"
// keys line up with LanePicker's Mark names so a hidden mark drops its strip.

export type ShotFieldKey =
  | 'approach'
  | 'stance'
  | 'target'
  | 'slide'
  | 'breakpoint'
  | 'hook'
  | 'miss'
  | 'note';

export const SHOT_FIELDS: { key: ShotFieldKey; label: string }[] = [
  { key: 'approach', label: 'Saved References' },
  { key: 'stance', label: 'Alignment (Starting Point)' },
  { key: 'target', label: 'Visual Target' },
  { key: 'slide', label: 'Slide Position (Finish)' },
  { key: 'breakpoint', label: 'Breakpoint' },
  { key: 'hook', label: 'Hook Timing' },
  { key: 'miss', label: 'Miss Direction' },
  { key: 'note', label: 'Note' },
];

export const SHOT_FIELD_KEYS: ShotFieldKey[] = SHOT_FIELDS.map((f) => f.key);

/** The four fields that render as LanePicker strips (in strip order). */
export const SHOT_MARK_FIELDS = ['stance', 'target', 'slide', 'breakpoint'] as const;
