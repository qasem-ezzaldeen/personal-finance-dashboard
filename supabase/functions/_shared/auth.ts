import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Caller = { kind: "scheduler" } | { kind: "user"; userId: string } | { kind: "anonymous" };

/** Identifies who is calling: the scheduler (service role key) or a signed-in user. */
export async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { kind: "anonymous" };
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return { kind: "scheduler" };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { kind: "anonymous" };
  return { kind: "user", userId: data.user.id };
}
