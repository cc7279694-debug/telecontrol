"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

let browserClient: SupabaseClient | undefined;

export function createBrowserSupabaseClient(): SupabaseClient {
  if (!browserClient) {
    const { supabaseUrl, publishableKey } = getPublicEnv();
    browserClient = createBrowserClient(supabaseUrl, publishableKey);
  }
  return browserClient;
}
