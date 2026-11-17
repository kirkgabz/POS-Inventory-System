import { supabase } from './supabase';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Random one-time invitation code, e.g. TB-7KQ2M-X9HPA (≈50 bits). */
export function generateInviteCode(): string {
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  const chars = Array.from(buf, (n) => ALPHABET[n % ALPHABET.length]).join('');
  return `TB-${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export const inviteLink = (code: string) => `${window.location.origin}/?invite=${encodeURIComponent(code)}`;

/** Accepts a full invitation link or just the code; returns the normalised code. */
export function parseInvite(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const c = url.searchParams.get('invite');
    if (c) return c.trim().toUpperCase();
  } catch {
    /* not a URL */
  }
  const m = raw.match(/invite=([A-Za-z0-9-]+)/);
  return (m ? m[1]! : raw).trim().toUpperCase();
}

export interface InviteCheck {
  valid: boolean;
  reason?: 'not_found' | 'revoked' | 'used' | 'expired';
  invited_name?: string | null;
  email?: string | null;
  expires_at?: string;
  owner?: string | null;
}

export async function checkInvite(code: string): Promise<InviteCheck> {
  const { data, error } = await supabase.rpc('check_staff_invite', { p_code: code });
  if (error) return { valid: false, reason: 'not_found' };
  return data as InviteCheck;
}

export const inviteReasonText: Record<NonNullable<InviteCheck['reason']>, string> = {
  not_found: 'This invitation link is not valid. Check that you copied the whole link.',
  revoked: 'This invitation was cancelled by the store owner.',
  used: 'This invitation has already been used.',
  expired: 'This invitation has expired. Ask the store owner for a new one.',
};
