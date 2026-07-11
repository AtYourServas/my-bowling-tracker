import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase';

const PROTECTED_ROUTES = ['/dashboard', '/balls', '/approaches', '/sessions', '/stats'];
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

  return next();
});
