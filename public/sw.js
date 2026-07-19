// Offline Phase 3 -- service worker for the shot-logging game page.
//
// Scope is deliberately narrow: this app is a server-rendered MPA (Astro
// `output: 'server'`, no client router), so there is no separate static
// "app shell" to precache -- every page, including the game page, is a live
// Supabase-backed render. Caching here means "keep the last successfully
// rendered copy of the game page itself" so it can still load with zero
// connectivity, not a data-free shell. Bump CACHE_VERSION when this file's
// caching logic changes so old entries (including stale game-page HTML) get
// evicted on the next activate.
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `bowling-static-${CACHE_VERSION}`;
const GAME_CACHE = `bowling-game-${CACHE_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, GAME_CACHE];

// Fixed, guaranteed-to-exist files -- kept small so `cache.addAll` (which
// fails atomically if any one request 404s) can't fail at install time.
const PRECACHE_URLS = [
  '/offline.html',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

// The game page itself, e.g. /sessions/<id>/games/<id> (optionally with a
// trailing slash) -- NOT /sidebar.json, /leave-notes-fragment, or the shot
// editor sub-route, all of which stay online-only exactly as today.
const GAME_PAGE_PATTERN = /^\/sessions\/[^/]+\/games\/[^/]+\/?$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(pathname) {
  return pathname.startsWith('/_astro/') || PRECACHE_URLS.includes(pathname);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// Keyed by pathname alone (query string dropped), not the exact request URL.
// Phase 1's shot logger advances through frames client-side via
// history.replaceState -- no new navigation, so the SW never sees a fetch for
// ?frame=2, ?frame=3, etc. Caching per exact URL would only ever have an
// entry for whichever frame the page happened to be on at the last real
// document load, so a later reload from a different frame (the common case
// once you're a few balls into the game) would miss the cache and hit
// /offline.html even though this game page was genuinely already visited.
// One entry per game instead -- always the most recent real navigation's
// snapshot, regardless of which frame's URL triggered the reload.
function gameCacheKey(url) {
  return url.origin + url.pathname;
}

async function networkFirstGamePage(request) {
  const cache = await caches.open(GAME_CACHE);
  const key = gameCacheKey(new URL(request.url));
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    const staticCache = await caches.open(STATIC_CACHE);
    const offline = await staticCache.match('/offline.html');
    if (offline) return offline;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept log_shot/log_shorthand/save_as_approach POSTs
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase calls etc.

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate' && GAME_PAGE_PATTERN.test(url.pathname)) {
    event.respondWith(networkFirstGamePage(request));
  }
  // Everything else (dashboard, sessions list, login, sidebar.json,
  // leave-notes-fragment, the shot editor, ...) -- default network behavior.
});
