import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Turn a Supabase / Postgres error into a friendly sentence. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  const msg =
    typeof err === 'string'
      ? err
      : (err as { message?: string }).message ?? 'Something went wrong.';
  if (/duplicate key.*barcode/i.test(msg)) return 'That barcode is already used by another product.';
  if (/duplicate key.*word_code/i.test(msg)) return 'That word code is already used by another product.';
  if (/row-level security/i.test(msg)) return 'You are not authorized to do that. Ask an admin for access.';
  return msg;
}
