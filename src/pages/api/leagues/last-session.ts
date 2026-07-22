import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, locals }) => {
  const { user, supabase } = locals;
  if (!user) return new Response(null, { status: 401 });

  const league_id = url.searchParams.get('league_id');
  if (!league_id) return new Response(null, { status: 400 });

  const { data } = await supabase
    .from('sessions')
    .select('alley_name, lane_number, second_lane_number')
    .eq('league_id', league_id)
    .eq('session_type', 'league')
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return new Response(JSON.stringify(data ?? null), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
