import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { WorkerConfig } from "../config.js";

export function createSupabaseAdmin(config: WorkerConfig): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
