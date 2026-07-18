import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase';

const PROTECTED_ROUTES = ['/dashboard', '/balls', '/approaches', '/sessions', '/stats', '/leagues', '/notes', '/settings', '/drills'];
const AUTH_ROUTES = ['/login', '/signup'];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createSupabaseServerClient(context.cookies, context.request);
  context.locals.supabase = supabase;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  context.locals.user = user;

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
