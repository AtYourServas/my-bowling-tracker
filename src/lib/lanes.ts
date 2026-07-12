/**
 * A session's lane configuration. `laneNumber` is the starting lane (frame 1);
 * `secondLaneNumber` is the other lane of the pair, or null for a single-lane
 * session (the legacy shape, where every frame is bowled on the one lane).
 */
export type LaneConfig = {
  laneNumber: number | null;
  secondLaneNumber: number | null;
};

/** True when the session is bowled on a two-lane pair. */
export function hasLanePair(config: LaneConfig): boolean {
  return config.laneNumber != null && config.secondLaneNumber != null;
}

/**
 * The lane a given frame is bowled on under strict alternation: odd frames on
 * the starting lane, even frames on the second lane. Falls back to the starting
 * lane when there's no pair (single-lane or unset), so it's always safe to call.
 */
export function laneForFrame(frameNumber: number, config: LaneConfig): number | null {
  if (!hasLanePair(config)) return config.laneNumber;
  return frameNumber % 2 === 1 ? config.laneNumber : config.secondLaneNumber;
}

/**
 * Human label for a session's lanes: "Lanes 7 & 8" for a pair, "Lane 7" for a
 * single lane, or null when no lane is set.
 */
export function laneLabel(config: LaneConfig): string | null {
  if (hasLanePair(config)) return `Lanes ${config.laneNumber} & ${config.secondLaneNumber}`;
  if (config.laneNumber != null) return `Lane ${config.laneNumber}`;
  return null;
}

/** Pulls a LaneConfig out of a raw session row (snake_case columns). */
export function laneConfigFromSession(session: {
  lane_number: number | null;
  second_lane_number: number | null;
}): LaneConfig {
  return { laneNumber: session.lane_number, secondLaneNumber: session.second_lane_number };
}
