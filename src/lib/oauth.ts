import { rememberMe, supabase } from './supabase';

/** Why the user went to Google: to create a store-owner account, or just to sign in. */
export type OAuthIntent = 'owner' | 'signin';
const KEY = 'tb-oauth-intent';

export function setOAuthIntent(i: OAuthIntent) {
  try {
    localStorage.setItem(KEY, i);
  } catch {
    /* ignore */
  }
}
export function getOAuthIntent(): OAuthIntent {
  try {
    return localStorage.getItem(KEY) === 'owner' ? 'owner' : 'signin';
  } catch {
    return 'signin';
  }
}
export function clearOAuthIntent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function continueWithGoogle(intent: OAuthIntent, remember = true) {
  setOAuthIntent(intent);
  rememberMe.set(remember);
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
  });
}
