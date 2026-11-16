import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { AppNotification } from '../lib/types';
import { useAuth } from './AuthContext';

interface NotificationState {
  unread: number;
  /** Cards currently floating on screen (admin pop-ups) */
  popups: AppNotification[];
  dismissPopup: (id: string) => void;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
  /** bump to make pages refetch their list */
  version: number;
}

const Ctx = createContext<NotificationState | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { profile, isAdmin } = useAuth();
  const uid = profile?.id;
  const [unread, setUnread] = useState(0);
  const [popups, setPopups] = useState<AppNotification[]>([]);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (!uid) return setUnread(0);
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', uid)
      .eq('is_read', false);
    setUnread(count ?? 0);
  }, [uid]);

  // Initial load: show up to 3 unread as pop-up cards so admins catch up after logging in
  useEffect(() => {
    if (!uid || !isAdmin) return;
    refresh();
    supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', uid)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => data && setPopups((data as AppNotification[]).reverse()));
  }, [uid, isAdmin, refresh]);

  // Realtime: new notification → pop-up card + chime
  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`notif-${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${uid}` },
        (payload) => {
          const n = payload.new as AppNotification;
          setPopups((p) => [...p.slice(-3), n]);
          setUnread((u) => u + 1);
          setVersion((v) => v + 1);
          chime();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid]);

  const dismissPopup = useCallback((id: string) => setPopups((p) => p.filter((n) => n.id !== id)), []);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      await supabase.from('notifications').update({ is_read: true }).in('id', ids);
      setPopups((p) => p.filter((n) => !ids.includes(n.id)));
      await refresh();
      setVersion((v) => v + 1);
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    await supabase.from('notifications').update({ is_read: true }).eq('recipient_id', uid).eq('is_read', false);
    setPopups([]);
    setUnread(0);
    setVersion((v) => v + 1);
  }, [uid]);

  return (
    <Ctx.Provider value={{ unread, popups, dismissPopup, markRead, markAllRead, refresh, version }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return ctx;
}

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.32);
    });
  } catch {
    /* ignore */
  }
}
