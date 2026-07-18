import type { SupabaseClient } from '@supabase/supabase-js';
import { leaveLabel, sortedLeave } from './leaves';

export type DrillShotLite = { pins_standing: number[] | null; foul: boolean };

// A shot "hits" when it clears the drill's target leave outright -- a fouled
// delivery never counts, mirroring how frameRollsDetailed treats a foul in
// the real scoring engine (0 pins, no credit), just without frame context.
export function isHit(shot: DrillShotLite): boolean {
  return !shot.foul && (shot.pins_standing?.length ?? 0) === 0;
}

export type DrillSummary = {
  id: string;
  leave: number[];
  endedAt: string | null;
  createdAt: string;
  shotCount: number;
  hitCount: number;
};

/** Every drill with its shot/hit counts, newest first -- one query for the /drills list. */
export async function fetchDrillsWithStats(supabase: SupabaseClient): Promise<DrillSummary[]> {
  const { data } = await supabase
    .from('drills')
    .select('id, leave, ended_at, created_at, drill_shots(pins_standing, foul)')
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
    };
  });
}

export type LeaveBreakdown = { leave: number[]; name: string; attempts: number; hits: number };
export type DrillOverallStats = { attempts: number; hits: number; byLeave: LeaveBreakdown[] };

/**
 * Aggregate conversion rate + a per-target-leave breakdown, purely in memory off
 * fetchDrillsWithStats -- kept separate from stats.ts on purpose: a drill shot
 * isn't a game shot, so it never feeds the main Stats page's strike%/carry/etc.
 */
export function computeDrillOverallStats(drills: DrillSummary[]): DrillOverallStats {
  let attempts = 0;
  let hits = 0;
  const byLeaveMap = new Map<string, LeaveBreakdown>();

  for (const d of drills) {
    attempts += d.shotCount;
    hits += d.hitCount;
    if (d.shotCount === 0) continue;

    const key = sortedLeave(d.leave).join('-');
    const existing = byLeaveMap.get(key);
    if (existing) {
      existing.attempts += d.shotCount;
      existing.hits += d.hitCount;
    } else {
      byLeaveMap.set(key, { leave: d.leave, name: leaveLabel(d.leave), attempts: d.shotCount, hits: d.hitCount });
    }
  }

  return { attempts, hits, byLeave: [...byLeaveMap.values()].sort((a, b) => b.attempts - a.attempts) };
}
