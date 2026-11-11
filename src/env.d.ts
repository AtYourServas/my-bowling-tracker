/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

import type { SupabaseClient } from '@supabase/supabase-js';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      /** The signed-in user, from the verified session JWT's claims (see middleware.ts). */
      user: { id: string; email?: string } | null;
      /** Profile display prefs for Layout.astro, already in flight (see middleware.ts). */
      layoutPrefs?: Promise<{ show_pinfall: boolean | null; theme: string | null } | null>;
    }
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
