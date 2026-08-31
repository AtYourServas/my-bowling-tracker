// The optional columns a bowler can show or hide on the Sessions table
// (profiles.hidden_session_columns, PR for the sessions column chooser). Date
// and Session are core and always shown -- Session is the row's link into the
// session, and Date carries the league/practice colour stripe. Everything below
// is toggleable; hidden keys are stored, so a column not listed stays visible
// (same convention as hidden_shot_fields / hidden_approach_fields).

export type SessionColumnKey = 'lane' | 'games' | 'series' | 'avg' | 'hdcp';

export const SESSION_COLUMNS: { key: SessionColumnKey; label: string }[] = [
  { key: 'lane', label: 'Lane' },
  { key: 'games', label: 'Game Scores' },
  { key: 'series', label: 'Series' },
  { key: 'avg', label: 'Average' },
  { key: 'hdcp', label: 'Handicap' },
];

export const SESSION_COLUMN_KEYS: SessionColumnKey[] = SESSION_COLUMNS.map((c) => c.key);
