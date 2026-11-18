import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

/**
 * Who is online right now (live, via Realtime presence) and when everyone was
 * last active (heartbeat saved to user_presence — only the store owner can read it).
 */
interface PresenceState {
  online: Set<string>;
  lastSeen: Record<string, string>;
}

const PresenceContext = createContext<PresenceState>({ online: new Set(), lastSeen: {} });

const HEARTBEAT_MS = 60_000;

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { profile, isAdmin } = useAuth();
  const uid = profile?.is_active ? profile.id : undefined;
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [lastSeen, setLastSeen] = useState<Record<string, string>>({});

  // Announce myself + keep "last active" fresh while the app is open
  useEffect(() => {
    if (!uid) return;
    const touch = () => {
      supabase.rpc('touch_presence').then(({ data }) => {
        if (data) setLastSeen((m) => ({ ...m, [uid]: data as string }));
      });
    };

    const ch = supabase.channel('tb-online', { config: { presence: { key: uid } } });
    ch.on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch.presenceState()))))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.track({ at: new Date().toISOString() });
      });

    touch();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') touch();
    }, HEARTBEAT_MS);
    // Leaving the tab / closing the app still records the moment they left
    const onVis = () => touch();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', touch);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', touch);
      touch();
      supabase.removeChannel(ch);
      setOnline(new Set());
    };
  }, [uid]);

  // Store owner: everyone's "last active" time, kept live
  useEffect(() => {
    if (!uid || !isAdmin) return;
    let alive = true;
    supabase
      .from('user_presence')
      .select('user_id, last_seen_at')
      .then(({ data }) => {
        if (!alive || !data) return;
        setLastSeen(Object.fromEntries(data.map((r) => [r.user_id as string, r.last_seen_at as string])));
      });
    const ch = supabase
      .channel('tb-presence-db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, (p) => {
        const row = p.new as { user_id?: string; last_seen_at?: string };
        if (row?.user_id && row.last_seen_at) setLastSeen((m) => ({ ...m, [row.user_id!]: row.last_seen_at! }));
      })
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [uid, isAdmin]);

  return <PresenceContext.Provider value={{ online, lastSeen }}>{children}</PresenceContext.Provider>;
}

export const usePresence = () => useContext(PresenceContext);

/** "Active 30 mins ago", "Active yesterday", … */
export function activeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'Not active yet';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  if (m < 1) return 'Active just now';
  if (m < 60) return `Active ${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Active ${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Active yesterday';
  if (d < 7) return `Active ${d} days ago`;
  return `Active ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
