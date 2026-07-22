import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const { user, supabase } = locals;
  if (!user) return new Response(null, { status: 401 });

  const body = await request.json().catch(() => null);
  const theme = body?.theme;
  if (theme !== 'light' && theme !== 'dark') {
    return new Response(null, { status: 400 });
  }

  const { error } = await supabase.from('profiles').upsert({ id: user.id, theme });
  if (error) return new Response(null, { status: 500 });

  return new Response(null, { status: 204 });
};
