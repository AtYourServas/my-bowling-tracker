import type { SupabaseClient } from '@supabase/supabase-js';
import { leaveLabel, sortedLeave } from './leaves';

export type DrillShotLite = { pins_standing: number[] | null; foul: boolean; leave: number[] };

// A shot "hits" when it clears its target leave outright -- a fouled delivery
// never counts, mirroring how frameRollsDetailed treats a foul in the real
// scoring engine (0 pins, no credit), just without frame context.
export function isHit(shot: { pins_standing: number[] | null; foul: boolean }): boolean {
  return !shot.foul && (shot.pins_standing?.length ?? 0) === 0;
}

export type DrillSummary = {
  id: string;
  /** The drill's CURRENT target -- what the next shot (if any) will face. Past
   *  shots may have targeted something else; see shots[].leave. */
  leave: number[];
  endedAt: string | null;
  createdAt: string;
  shotCount: number;
  hitCount: number;
  shots: DrillShotLite[];
};

/** Every drill with its shots, newest first -- one query for the /drills list + stats. */
export async function fetchDrillsWithStats(supabase: SupabaseClient): Promise<DrillSummary[]> {
  const { data } = await supabase
    .from('drills')
    .select('id, leave, ended_at, created_at, drill_shots(pins_standing, foul, leave)')
    .order('created_at', { ascending: false });

  return (data ?? []).map((d: any) => {
    const shots = (d.drill_shots ?? []) as DrillShotLite[];
    return {
      id: d.id,
      leave: d.leave ?? [],
      endedAt: d.ended_at,
      createdAt: d.created_at,
      shotCount: shots.length,
      hitCount: shots.filter(isHit).length,
      shots,
    };
  });
}

export type LeaveBreakdown = { leave: number[]; name: string; attempts: number; hits: number };
export type DrillOverallStats = { attempts: number; hits: number; byLeave: LeaveBreakdown[] };

/**
 * Aggregate conversion rate + a per-target-leave breakdown, purely in memory off
 * fetchDrillsWithStats -- kept separate from stats.ts on purpose: a drill shot
 * isn't a game shot, so it never feeds the main Stats page's strike%/carry/etc.
 * Grouped by each SHOT's own target (not the parent drill's current one), so a
 * drill that switched targets mid-session attributes each shot correctly.
 */
export function computeDrillOverallStats(drills: DrillSummary[]): DrillOverallStats {
  let attempts = 0;
  let hits = 0;
  const byLeaveMap = new Map<string, LeaveBreakdown>();

  for (const shot of drills.flatMap((d) => d.shots)) {
    attempts += 1;
    const hit = isHit(shot);
    if (hit) hits += 1;

    const key = sortedLeave(shot.leave).join('-');
    const existing = byLeaveMap.get(key);
    if (existing) {
      existing.attempts += 1;
      if (hit) existing.hits += 1;
    } else {
      byLeaveMap.set(key, { leave: shot.leave, name: leaveLabel(shot.leave), attempts: 1, hits: hit ? 1 : 0 });
    }
  }

  return { attempts, hits, byLeave: [...byLeaveMap.values()].sort((a, b) => b.attempts - a.attempts) };
}
