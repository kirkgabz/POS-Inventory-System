import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Message } from '../lib/types';
import { useAuth } from './AuthContext';

interface MessageState {
  /** unread messages + replies addressed to me */
  unread: number;
  /** reminders sent to me that aren't done yet */
  openReminders: number;
  /** floating cards for newly arrived messages */
  popups: Message[];
  dismissPopup: (id: string) => void;
  refresh: () => Promise<void>;
  /** bumps whenever something changes, so pages refetch */
  version: number;
}

const Ctx = createContext<MessageState | null>(null);

export function MessageProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const uid = profile?.id;
  const [unread, setUnread] = useState(0);
  const [openReminders, setOpenReminders] = useState(0);
  const [popups, setPopups] = useState<Message[]>([]);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (!uid) {
      setUnread(0);
      setOpenReminders(0);
      return;
    }
    const [{ count: u }, { count: r }] = await Promise.all([
      supabase.from('message_recipients').select('message_id', { count: 'exact', head: true }).eq('recipient_id', uid).is('read_at', null),
      supabase
        .from('message_recipients')
        .select('message_id, message:messages!inner(kind)', { count: 'exact', head: true })
        .eq('recipient_id', uid)
        .is('done_at', null)
        .eq('message.kind', 'reminder'),
    ]);
    setUnread(u ?? 0);
    setOpenReminders(r ?? 0);
  }, [uid]);

  // on sign-in: catch up with up to 3 unread items as pop-ups
  useEffect(() => {
    if (!uid) return;
    refresh();
    supabase
      .from('message_recipients')
      .select('message:messages(*)')
      .eq('recipient_id', uid)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        const list = ((data ?? []) as unknown as { message: Message | null }[]).map((r) => r.message).filter(Boolean) as Message[];
        setPopups(list.reverse());
      });
  }, [uid, refresh]);

  // live: something new for me → pop-up + chime; any change → recount
  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`msg-${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_recipients', filter: `recipient_id=eq.${uid}` },
        async (payload) => {
          const { data } = await supabase.from('messages').select('*').eq('id', (payload.new as { message_id: string }).message_id).maybeSingle();
          if (data) {
            setPopups((p) => [...p.filter((m) => m.id !== data.id).slice(-2), data as Message]);
            chime();
          }
          refresh();
          setVersion((v) => v + 1);
        },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_recipients' }, () => {
        refresh();
        setVersion((v) => v + 1);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, () => {
        refresh();
        setVersion((v) => v + 1);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid, refresh]);

  const dismissPopup = useCallback((id: string) => setPopups((p) => p.filter((m) => m.id !== id)), []);

  return <Ctx.Provider value={{ unread, openReminders, popups, dismissPopup, refresh, version }}>{children}</Ctx.Provider>;
}

export function useMessages() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMessages must be used inside <MessageProvider>');
  return ctx;
}

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.14);
      o.stop(ctx.currentTime + i * 0.14 + 0.32);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* sound is optional */
  }
}
