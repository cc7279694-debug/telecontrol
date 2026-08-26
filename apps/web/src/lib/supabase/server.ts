import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "../env";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, publishableKey } = getPublicEnv();

  return createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot always mutate cookies; middleware refreshes them.
        }
      },
    },
  });
}

export function createBearerSupabaseClient(accessToken: string) {
  const { supabaseUrl, publishableKey } = getPublicEnv();
  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
