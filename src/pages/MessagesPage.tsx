import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BellRing,
  CheckCircle2,
  Circle,
  Inbox,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  Send,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { useMessages } from '../context/MessageContext';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success, toast } from '../lib/alerts';
import { fmtDate, initials, roleName, timeAgo } from '../lib/format';
import { dueLabel, markMessage, sendMessage } from '../lib/messages';
import type { Message, MessageRecipient } from '../lib/types';

type Tab = 'inbox' | 'reminders' | 'sent';
type Kind = 'message' | 'reminder';

interface Thread {
  root: Message;
  /** my recipient row for the root (null when I sent it) */
  mine: MessageRecipient | null;
  latestAt: string;
  unread: number;
  lastFrom: string;
  lastBody: string;
}

interface SentItem extends Message {
  message_recipients: (MessageRecipient & { recipient: { full_name: string } | null })[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function MessagesPage() {
  const { profile, isAdmin } = useAuth();
  const uid = profile?.id;
  const { version, refresh: refreshCounts } = useMessages();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('inbox');
  const [rows, setRows] = useState<MessageRecipient[]>([]);
  const [roots, setRoots] = useState<Record<string, Message>>({});
  const [sent, setSent] = useState<SentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState<Kind | null>(null);
  const openId = params.get('open');

  const load = useCallback(async () => {
    if (!uid) return;
    const [{ data: r }, sentRes] = await Promise.all([
      supabase.from('message_recipients').select('*, message:messages(*)').eq('recipient_id', uid).order('created_at', { ascending: false }).limit(500),
      isAdmin
        ? supabase
            .from('messages')
            .select('*, message_recipients(*, recipient:profiles(full_name))')
            .eq('sender_id', uid)
            .is('parent_id', null)
            .order('created_at', { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [] as SentItem[] }),
    ]);
    const list = ((r ?? []) as MessageRecipient[]).filter((x) => x.message);
    const sentList = (sentRes.data ?? []) as SentItem[];
    // replies to messages I sent → their roots are in my Sent list (or fetch them)
    const map: Record<string, Message> = {};
    sentList.forEach((m) => (map[m.id] = m));
    list.forEach((x) => !x.message!.parent_id && (map[x.message!.id] = x.message!));
    const missing = [...new Set(list.map((x) => x.message!.parent_id).filter((id): id is string => !!id && !map[id]))];
    if (missing.length) {
      const { data } = await supabase.from('messages').select('*').in('id', missing);
      ((data ?? []) as Message[]).forEach((m) => (map[m.id] = m));
    }
    setRows(list);
    setRoots(map);
    setSent(sentList);
    setLoading(false);
  }, [uid, isAdmin]);

  useEffect(() => {
    load();
  }, [load, version]);

  // Inbox threads: everything addressed to me, grouped by conversation
  const threads = useMemo(() => {
    const m = new Map<string, Thread>();
    rows.forEach((x) => {
      const msg = x.message!;
      const rootId = msg.parent_id ?? msg.id;
      const root = roots[rootId];
      if (!root) return;
      const t = m.get(rootId) ?? { root, mine: null, latestAt: msg.created_at, unread: 0, lastFrom: msg.sender_name, lastBody: msg.body };
      if (!msg.parent_id) t.mine = x;
      if (!x.read_at) t.unread++;
      if (msg.created_at >= t.latestAt) {
        t.latestAt = msg.created_at;
        t.lastFrom = msg.sender_name;
        t.lastBody = msg.body;
      }
      m.set(rootId, t);
    });
    return [...m.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  }, [rows, roots]);

  const myReminders = threads.filter((t) => t.root.kind === 'reminder' && t.mine);
  const openReminderCount = myReminders.filter((t) => !t.mine?.done_at).length;
  const sentReminders = sent.filter((s) => s.kind === 'reminder');

  const toggleDone = async (t: Thread) => {
    const done = !t.mine?.done_at;
    try {
      await markMessage(t.root.id, true, done);
      toast(done ? 'Reminder marked as done' : 'Reminder re-opened');
      await load();
      refreshCounts();
    } catch (e) {
      failure('Could not update', errorMessage(e));
    }
  };

  const removeSent = async (m: SentItem) => {
    const ok = await confirmAction({
      title: `Delete this ${m.kind}?`,
      html: `It will be removed for <b>${m.message_recipients.length}</b> staff member(s), with all replies.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('messages').delete().eq('id', m.id);
    if (error) return failure('Could not delete', errorMessage(error));
    success('Deleted');
    load();
  };

  const open = (id: string) => setParams({ open: id });
  const close = () => {
    setParams({});
    load();
    refreshCounts();
  };

  const tabs: { key: Tab; label: string; badge?: number; show: boolean }[] = [
    { key: 'inbox', label: 'Inbox', badge: threads.reduce((n, t) => n + (t.unread ? 1 : 0), 0), show: true },
    { key: 'reminders', label: 'Reminders', badge: isAdmin ? undefined : openReminderCount, show: true },
    { key: 'sent', label: 'Sent', show: isAdmin },
  ];

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">{isAdmin ? 'Notes & reminders for your staff' : 'From your store owner'}</span>
          <h1 className="display">Messages</h1>
        </div>
        {isAdmin && (
          <div className="row gap-sm">
            <button className="btn btn-ghost" onClick={() => setCompose('reminder')}>
              <BellRing size={16} /> New reminder
            </button>
            <button className="btn btn-primary" onClick={() => setCompose('message')}>
              <MessageSquarePlus size={16} /> New message
            </button>
          </div>
        )}
      </header>

      <div className="tabs">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {!!t.badge && <em>{t.badge}</em>}
            </button>
          ))}
      </div>

      {loading ? (
        <div className="table-skeleton">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : tab === 'inbox' ? (
        threads.length === 0 ? (
          <Empty icon={<Inbox size={36} strokeWidth={1.2} />} text={isAdmin ? 'Replies from your staff will appear here.' : 'No messages yet.'} />
        ) : (
          <ul className="msg-list">
            {threads.map((t) => (
              <ThreadRow key={t.root.id} t={t} onOpen={() => open(t.root.id)} onDone={t.mine && t.root.kind === 'reminder' ? () => toggleDone(t) : undefined} />
            ))}
          </ul>
        )
      ) : tab === 'reminders' ? (
        isAdmin ? (
          sentReminders.length === 0 ? (
            <Empty icon={<BellRing size={36} strokeWidth={1.2} />} text="No reminders sent yet." action={<button className="btn btn-primary" onClick={() => setCompose('reminder')}>New reminder</button>} />
          ) : (
            <ul className="msg-list">
              {sentReminders.map((m) => (
                <SentRow key={m.id} m={m} onOpen={() => open(m.id)} onDelete={() => removeSent(m)} />
              ))}
            </ul>
          )
        ) : myReminders.length === 0 ? (
          <Empty icon={<BellRing size={36} strokeWidth={1.2} />} text="No reminders for you." />
        ) : (
          <ul className="msg-list">
            {[...myReminders]
              .sort((a, b) => Number(!!a.mine?.done_at) - Number(!!b.mine?.done_at))
              .map((t) => (
                <ThreadRow key={t.root.id} t={t} onOpen={() => open(t.root.id)} onDone={() => toggleDone(t)} />
              ))}
          </ul>
        )
      ) : sent.length === 0 ? (
        <Empty icon={<Send size={36} strokeWidth={1.2} />} text="You haven't sent anything yet." action={<button className="btn btn-primary" onClick={() => setCompose('message')}>New message</button>} />
      ) : (
        <ul className="msg-list">
          {sent.map((m) => (
            <SentRow key={m.id} m={m} onOpen={() => open(m.id)} onDelete={() => removeSent(m)} />
          ))}
        </ul>
      )}

      {compose && (
        <Compose
          kind={compose}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            setTab('sent');
            load();
          }}
        />
      )}
      {openId && uid && <ThreadView rootId={openId} uid={uid} isAdmin={isAdmin} onClose={close} />}
    </div>
  );
}

function Empty({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <p>{text}</p>
      {action}
    </div>
  );
}

function ThreadRow({ t, onOpen, onDone }: { t: Thread; onOpen: () => void; onDone?: () => void }) {
  const r = t.root;
  const reminder = r.kind === 'reminder';
  const done = !!t.mine?.done_at;
  const due = reminder && !done ? dueLabel(r.due_at) : null;
  return (
    <li className={`msg-row ${t.unread ? 'unread' : ''} ${reminder ? 'is-reminder' : ''} ${done ? 'is-done' : ''}`}>
      {onDone ? (
        <button className="msg-check" onClick={onDone} title={done ? 'Mark as not done' : 'Mark as done'} aria-label={done ? 'Mark as not done' : 'Mark as done'}>
          {done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
        </button>
      ) : (
        <span className="msg-kind">{reminder ? <BellRing size={17} /> : <MessageSquareText size={17} />}</span>
      )}
      <button className="msg-main" onClick={onOpen}>
        <span className="msg-top">
          <b>{r.title || (reminder ? 'Reminder' : 'Message')}</b>
          {r.important && <span className="tag tag-important"><Star size={10} /> Important</span>}
          {due && <span className={`due-chip ${due.overdue ? 'over' : ''}`}>{due.text}</span>}
          {done && <span className="tag">Done</span>}
          <time>{timeAgo(t.latestAt)}</time>
        </span>
        <span className="msg-snippet">
          <span className="muted">{t.lastFrom}:</span> {t.lastBody}
        </span>
      </button>
      {t.unread > 0 && <i className="msg-dot" aria-label="Unread" />}
    </li>
  );
}

function SentRow({ m, onOpen, onDelete }: { m: SentItem; onOpen: () => void; onDelete: () => void }) {
  const total = m.message_recipients.length;
  const read = m.message_recipients.filter((r) => r.read_at).length;
  const done = m.message_recipients.filter((r) => r.done_at).length;
  const reminder = m.kind === 'reminder';
  const due = reminder ? dueLabel(m.due_at) : null;
  const names = m.to_all ? 'All staff' : m.message_recipients.map((r) => r.recipient?.full_name ?? '—').join(', ');
  return (
    <li className={`msg-row ${reminder ? 'is-reminder' : ''}`}>
      <span className="msg-kind">{reminder ? <BellRing size={17} /> : <MessageSquareText size={17} />}</span>
      <button className="msg-main" onClick={onOpen}>
        <span className="msg-top">
          <b>{m.title || (reminder ? 'Reminder' : 'Message')}</b>
          {m.important && <span className="tag tag-important"><Star size={10} /> Important</span>}
          {due && done < total && <span className={`due-chip ${due.overdue ? 'over' : ''}`}>{due.text}</span>}
          <time>{timeAgo(m.created_at)}</time>
        </span>
        <span className="msg-snippet">{m.body}</span>
        <span className="msg-meta">
          <Users size={12} /> {names}
          <span className="msg-progress">
            Read {read}/{total}
            {reminder && <> · Done {done}/{total}</>}
          </span>
        </span>
      </button>
      <button className="icon-btn danger" onClick={onDelete} title="Delete" aria-label="Delete">
        <Trash2 size={15} />
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function Compose({ kind: initial, onClose, onSent }: { kind: Kind; onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState<Kind>(initial);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [toAll, setToAll] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'staff')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setStaff((data as typeof staff) ?? []));
  }, []);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const count = toAll ? staff.length : picked.length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return failure('Write something first');
    if (!count) return failure('Choose who gets it', staff.length ? 'Pick at least one staff member, or choose All staff.' : 'You have no active staff yet — invite them in Staff & Access.');
    const who = toAll ? `all staff (${staff.length})` : staff.filter((s) => picked.includes(s.id)).map((s) => esc(s.full_name)).join(', ');
    const dueText = kind === 'reminder' && due ? dueLabel(new Date(due).toISOString())?.text : null;
    const ok = await confirmAction({
      title: kind === 'reminder' ? 'Send this reminder?' : 'Send this message?',
      html: `To <b>${who}</b>${title ? `<br/><b>${esc(title)}</b>` : ''}<br/><span class="muted">${esc(body.trim().slice(0, 140))}${body.trim().length > 140 ? '…' : ''}</span>${dueText ? `<br/><small>${dueText}</small>` : ''}`,
      confirmText: 'Send',
      icon: 'question',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await sendMessage({
        kind,
        body: body.trim(),
        title: title.trim() || null,
        toAll,
        recipients: toAll ? [] : picked,
        dueAt: kind === 'reminder' && due ? new Date(due).toISOString() : null,
        important,
      });
      success(kind === 'reminder' ? 'Reminder sent' : 'Message sent', `Delivered to ${count} staff member(s).`);
      onSent();
    } catch (err) {
      failure('Could not send', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'reminder' ? 'New reminder' : 'New message'}
      subtitle="Choose one, several or all of your staff."
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button form="compose-form" className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send{count ? ` to ${count}` : ''}
          </button>
        </>
      }
    >
      <form id="compose-form" className="stack" onSubmit={submit}>
        <div className="seg seg-wide">
          <button type="button" className={kind === 'message' ? 'on' : ''} onClick={() => setKind('message')}>
            <MessageSquareText size={15} /> Message
          </button>
          <button type="button" className={kind === 'reminder' ? 'on' : ''} onClick={() => setKind('reminder')}>
            <BellRing size={15} /> Reminder
          </button>
          <i className={`seg-pill ${kind === 'reminder' ? 'right' : ''}`} />
        </div>

        <div className="field">
          <span>To</span>
          <div className="to-picker">
            <button type="button" className={`chip-btn ${toAll ? 'on' : ''}`} onClick={() => setToAll(true)}>
              <Users size={13} /> All staff ({staff.length})
            </button>
            {staff.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip-btn ${!toAll && picked.includes(s.id) ? 'on' : ''}`}
                onClick={() => {
                  setToAll(false);
                  toggle(s.id);
                }}
              >
                {s.full_name}
              </button>
            ))}
          </div>
          {staff.length === 0 && <small className="muted">No active staff yet. Invite them in Staff &amp; Access.</small>}
        </div>

        <label className="field">
          <span>
            Title <small className="muted">— optional</small>
          </span>
          <input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'reminder' ? 'e.g. Count the soft drinks' : 'e.g. Schedule for Saturday'} />
        </label>
        <label className="field">
          <span>{kind === 'reminder' ? 'What to remember' : 'Message'}</span>
          <textarea className="input" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === 'reminder' ? 'Please restock the chiller before closing.' : 'Write your note to the staff…'} autoFocus />
        </label>

        {kind === 'reminder' && (
          <label className="field reveal">
            <span>
              Due <small className="muted">— optional</small>
            </span>
            <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />
          <span>Mark as important</span>
        </label>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function ThreadView({ rootId, uid, isAdmin, onClose }: { rootId: string; uid: string; isAdmin: boolean; onClose: () => void }) {
  const { version, refresh } = useMessages();
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [recips, setRecips] = useState<(MessageRecipient & { recipient: { full_name: string } | null })[]>([]);
  const [mine, setMine] = useState<MessageRecipient | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState('all');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const [{ data: r }, { data: rep }] = await Promise.all([
      supabase.from('messages').select('*').eq('id', rootId).maybeSingle(),
      supabase.from('messages').select('*').eq('parent_id', rootId).order('created_at'),
    ]);
    if (!r) return setMissing(true);
    setRoot(r as Message);
    const list = (rep as Message[]) ?? [];
    setReplies(list);
    const ids = [rootId, ...list.map((m) => m.id)];
    const { data: rows } = await supabase.from('message_recipients').select('*, recipient:profiles(full_name)').in('message_id', ids);
    const all = (rows ?? []) as (MessageRecipient & { recipient: { full_name: string } | null })[];
    setRecips(all.filter((x) => x.message_id === rootId));
    setMine(all.find((x) => x.message_id === rootId && x.recipient_id === uid) ?? null);
    // opening = read
    const unread = all.filter((x) => x.recipient_id === uid && !x.read_at);
    if (unread.length) {
      await Promise.all(unread.map((x) => markMessage(x.message_id)));
      refresh();
    }
  }, [rootId, uid, refresh]);

  useEffect(() => {
    load();
  }, [load, version]);

  if (missing)
    return (
      <Modal open onClose={onClose} title="Message not found">
        <p className="muted">It may have been deleted by the sender.</p>
      </Modal>
    );
  if (!root) return null;

  const iSent = root.sender_id === uid;
  const reminder = root.kind === 'reminder';
  const due = reminder ? dueLabel(root.due_at) : null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await sendMessage({ kind: 'message', body: text.trim(), parentId: root.id, recipients: iSent && replyTo !== 'all' ? [replyTo] : [] });
      setText('');
      toast('Reply sent');
      load();
    } catch (err) {
      failure('Could not send', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async () => {
    const done = !mine?.done_at;
    if (done && !(await confirmAction({ title: 'Mark as done?', text: 'The store owner will see that you finished this.', confirmText: 'Mark done' }))) return;
    try {
      await markMessage(root.id, true, done);
      success(done ? 'Marked as done' : 'Re-opened');
      load();
      refresh();
    } catch (err) {
      failure('Could not update', errorMessage(err));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={root.title || (reminder ? 'Reminder' : 'Message')}
      subtitle={
        <>
          {reminder ? 'Reminder' : 'Message'} from <b>{root.sender_name}</b> · {fmtDate(root.created_at)}
        </>
      }
      footer={
        <form className="reply-bar" onSubmit={send}>
          {iSent && recips.length > 1 && (
            <select className="input reply-to" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} aria-label="Reply to">
              <option value="all">To everyone ({recips.length})</option>
              {recips.map((r) => (
                <option key={r.recipient_id} value={r.recipient_id}>
                  To {r.recipient?.full_name ?? '—'} only
                </option>
              ))}
            </select>
          )}
          <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={iSent ? 'Write a reply…' : `Reply to ${root.sender_name}…`} maxLength={4000} />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Reply
          </button>
        </form>
      }
    >
      <div className="thread">
        <article className={`bubble root ${reminder ? 'is-reminder' : ''}`}>
          <div className="bubble-tags">
            {reminder && <span className="tag"><BellRing size={10} /> Reminder</span>}
            {root.important && <span className="tag tag-important"><Star size={10} /> Important</span>}
            {due && <span className={`due-chip ${due.overdue && !mine?.done_at ? 'over' : ''}`}>{due.text}</span>}
          </div>
          <p className="bubble-body">{root.body}</p>
          {reminder && mine && (
            <button className={`btn ${mine.done_at ? 'btn-ghost' : 'btn-primary'} btn-xs`} onClick={toggleDone}>
              {mine.done_at ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              {mine.done_at ? `Done · ${timeAgo(mine.done_at)}` : 'Mark as done'}
            </button>
          )}
        </article>

        {iSent && (
          <div className="recips">
            <span className="eyebrow">{root.to_all ? 'Sent to all staff' : 'Sent to'}</span>
            <ul>
              {recips.map((r) => (
                <li key={r.recipient_id}>
                  <span className="avatar sm">{initials(r.recipient?.full_name ?? '?')}</span>
                  <span className="grow">{r.recipient?.full_name ?? '—'}</span>
                  {reminder && (r.done_at ? <span className="tag tag-done">Done</span> : <span className="tag">Not done</span>)}
                  <small className="muted">{r.read_at ? `Read ${timeAgo(r.read_at)}` : 'Not read yet'}</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        {replies.length > 0 && <span className="eyebrow">Replies</span>}
        {replies.map((m) => (
          <article key={m.id} className={`bubble ${m.sender_id === uid ? 'me' : ''}`}>
            <header>
              <b>{m.sender_id === uid ? 'You' : m.sender_name}</b>
              {m.sender_role && m.sender_id !== uid && <small className="muted"> · {roleName(m.sender_role)}</small>}
              <time>{timeAgo(m.created_at)}</time>
            </header>
            <p className="bubble-body">{m.body}</p>
          </article>
        ))}
        {!replies.length && !isAdmin && <p className="muted small">Have a question? Reply below. Only {root.sender_name} will see it.</p>}
      </div>
    </Modal>
  );
}
