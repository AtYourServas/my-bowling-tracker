import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase';

const PROTECTED_ROUTES = ['/dashboard', '/balls', '/approaches', '/sessions', '/stats', '/leagues', '/notes', '/settings', '/drills'];
const AUTH_ROUTES = ['/login', '/signup'];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createSupabaseServerClient(context.cookies, context.request);
  context.locals.supabase = supabase;

  // getClaims() verifies the session JWT locally against the project's
  // published signing keys (cached), instead of getUser()'s round-trip to the
  // Supabase Auth server on every single request -- that extra hop was paid
  // before any page or endpoint could even start its own queries. On a
  // project still using a legacy shared-secret key it falls back to the same
  // server check getUser() did, so it's never less safe.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const user = claims ? { id: claims.sub, email: claims.email } : null;
  context.locals.user = user;

  // Layout.astro needs the profile's display prefs on every page, but a
  // layout's frontmatter only runs after the page's own queries finish. Start
  // that query now so it overlaps the page's work instead of trailing it.
  // Full-page GETs only -- background fetches (fragments, form POSTs) don't
  // render the layout.
  if (user && context.request.method === 'GET' && context.request.headers.get('accept')?.includes('text/html')) {
    context.locals.layoutPrefs = Promise.resolve(
      supabase.from('profiles').select('show_pinfall, theme').eq('id', user.id).maybeSingle(),
    )
      .then(({ data }) => data)
      .catch(() => null);
  }

  const pathname = context.url.pathname;

  if (!user && PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    return context.redirect('/login');
  }

  if (user && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return context.redirect('/dashboard');
  }

  const response = await next();

  // Signed-in pages render personal, mutable data and must never be served
  // from a cache. Without an explicit header Safari heuristically caches them
  // (and happily restores them from its back/forward cache), so a page like
  // /settings could show stale values after a successful save. no-store also
  // keeps these pages out of Safari's bfcache.
  if (PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    response.headers.set('Cache-Control', 'no-store');
  }

  return response;
});
