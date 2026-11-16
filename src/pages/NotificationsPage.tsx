import { useCallback, useEffect, useState } from 'react';
import { BellOff, CheckCheck, Trash2 } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { notifIcon, NotifDetail } from '../components/NotificationCards';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { fmtDate, timeAgo } from '../lib/format';
import type { AppNotification } from '../lib/types';

export default function NotificationsPage() {
  const { markRead, markAllRead, refresh, version, unread } = useNotifications();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [only, setOnly] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(200);
    if (only === 'unread') q = q.eq('is_read', false);
    const { data } = await q;
    setItems((data as AppNotification[]) ?? []);
    setLoading(false);
  }, [only]);

  useEffect(() => {
    load();
  }, [load, version]);

  const readAll = async () => {
    if (!unread) return;
    if (await confirmAction({ title: 'Mark all as read?', text: `${unread} unread notification(s).`, confirmText: 'Mark all read' })) {
      await markAllRead();
      success('All caught up');
    }
  };

  const remove = async (n: AppNotification) => {
    if (!(await confirmAction({ title: 'Delete notification?', text: n.message, confirmText: 'Delete', danger: true }))) return;
    const { error } = await supabase.from('notifications').delete().eq('id', n.id);
    if (error) return failure('Could not delete', errorMessage(error));
    setItems((l) => l.filter((x) => x.id !== n.id));
    refresh();
    success('Deleted');
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">Activity from your staff</span>
          <h1 className="display">Notifications</h1>
        </div>
        <button className="btn btn-ghost" onClick={readAll} disabled={!unread}>
          <CheckCheck size={16} /> Mark all read
        </button>
      </header>

      <div className="tabs">
        <button className={`tab ${only === 'all' ? 'on' : ''}`} onClick={() => setOnly('all')}>
          All
        </button>
        <button className={`tab ${only === 'unread' ? 'on' : ''}`} onClick={() => setOnly('unread')}>
          Unread <em>{unread}</em>
        </button>
      </div>

      {loading ? (
        <div className="table-skeleton">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 84 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <BellOff size={36} strokeWidth={1.2} />
          <p>Nothing here. Your staff's changes will appear as they happen.</p>
        </div>
      ) : (
        <div className="timeline">
          {items.map((n, i) => (
            <article
              key={n.id}
              className={`tl-item t-${n.type} ${n.is_read ? 'read' : ''} row-in`}
              style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}
              onClick={() => !n.is_read && markRead([n.id]).then(load)}
            >
              <div className="notif-icon">{notifIcon(n.type)}</div>
              <div className="grow">
                <header>
                  <strong>{n.title}</strong>
                  {!n.is_read && <span className="dot" />}
                  <time title={fmtDate(n.created_at)}>{timeAgo(n.created_at)}</time>
                </header>
                <p>{n.message}</p>
                <NotifDetail n={n} />
              </div>
              <button
                className="icon-btn danger"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(n);
                }}
                aria-label="Delete"
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
