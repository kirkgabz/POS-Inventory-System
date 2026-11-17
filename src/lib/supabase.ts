import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

/* "Remember me": keep the session in localStorage (survives closing the browser)
   or sessionStorage (cleared when the browser/tab closes). */
const REMEMBER_KEY = 'jen-remember';
export const rememberMe = {
  get(): boolean {
    try {
      return localStorage.getItem(REMEMBER_KEY) !== '0';
    } catch {
      return true;
    }
  },
  set(on: boolean) {
    try {
      localStorage.setItem(REMEMBER_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  },
};

const safe = (fn: () => Storage) => {
  try {
    return fn();
  } catch {
    return null;
  }
};
const authStorage = {
  getItem(k: string) {
    const primary = safe(() => (rememberMe.get() ? localStorage : sessionStorage));
    const other = safe(() => (rememberMe.get() ? sessionStorage : localStorage));
    return primary?.getItem(k) ?? other?.getItem(k) ?? null;
  },
  setItem(k: string, v: string) {
    const remember = rememberMe.get();
    safe(() => (remember ? localStorage : sessionStorage))?.setItem(k, v);
    safe(() => (remember ? sessionStorage : localStorage))?.removeItem(k);
  },
  removeItem(k: string) {
    safe(() => localStorage)?.removeItem(k);
    safe(() => sessionStorage)?.removeItem(k);
  },
};

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage },
});

/** Which social sign-ins are switched on in Supabase (public endpoint). */
export async function enabledProviders(): Promise<{ google: boolean; apple: boolean }> {
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key ?? '' } });
    const s = await res.json();
    return { google: !!s?.external?.google, apple: !!s?.external?.apple };
  } catch {
    return { google: false, apple: false };
  }
}

/** Turn a Supabase / Postgres error into a friendly sentence. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  const msg =
    typeof err === 'string'
      ? err
      : (err as { message?: string }).message ?? 'Something went wrong.';
  if (/duplicate key.*barcode/i.test(msg)) return 'That barcode is already used by another product.';
  if (/duplicate key.*word_code/i.test(msg)) return 'That word code is already used by another product.';
  if (/row-level security/i.test(msg)) return 'You are not authorized to do that. Ask the store owner for access.';
  if (/TB_INVITE_EMAIL/.test(msg)) return 'This invitation was made for a different email address.';
  if (/TB_INVITE_INVALID|Database error saving new user/i.test(msg))
    return 'Your invitation is not valid (it may be used, expired or cancelled). Ask the store owner for a new link.';
  if (/TB_OWNER_KEY_INVALID/.test(msg)) return 'The store owner key is not valid.';
  if (/TB_OTP_REQUIRED/.test(msg)) return 'Enter the 6-digit code from your email first.';
  if (/Token has expired|otp_expired|invalid.*otp/i.test(msg)) return 'That code is wrong or has expired. Send a new one.';
  return msg;
}
