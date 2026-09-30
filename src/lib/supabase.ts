import { createClient, type PostgrestError } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. See docs/SETUP.md.");
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Turns Supabase errors into plain Errors with a readable message. */
export function toError(error: PostgrestError | Error | { message?: string } | null | undefined): Error {
  if (!error) return new Error("Something went wrong");
  if (error instanceof Error) return error;
  return new Error(error.message || "Something went wrong");
}

export function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw toError(result.error);
  return result.data as T;
}
