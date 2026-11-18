import { supabase } from './supabase';

export interface SendInput {
  kind: 'message' | 'reminder';
  body: string;
  title?: string | null;
  recipients?: string[];
  toAll?: boolean;
  dueAt?: string | null;
  important?: boolean;
  parentId?: string | null;
}

export async function sendMessage(i: SendInput) {
  const { data, error } = await supabase.rpc('send_message', {
    p_kind: i.kind,
    p_body: i.body,
    p_title: i.title ?? null,
    p_recipients: i.recipients ?? null,
    p_to_all: !!i.toAll,
    p_due_at: i.dueAt ?? null,
    p_important: !!i.important,
    p_parent: i.parentId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function markMessage(id: string, read = true, done: boolean | null = null) {
  const { error } = await supabase.rpc('mark_message', { p_message: id, p_read: read, p_done: done });
  if (error) throw error;
}

/** "Due today 5:00 PM", "Overdue · Nov 18", … */
export function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000);
  const overdue = d.getTime() < now.getTime();
  const day = sameDay(d, now)
    ? 'today'
    : sameDay(d, tomorrow)
      ? 'tomorrow'
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { text: overdue ? `Overdue · ${day} ${time}` : `Due ${day} ${time}`, overdue };
}
