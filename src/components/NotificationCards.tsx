import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, PackagePlus, Tag, UserPlus, Boxes, PencilLine, X } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import type { AppNotification } from '../lib/types';
import { fmtMoney, timeAgo } from '../lib/format';

export const notifIcon = (type: AppNotification['type'], size = 18) => {
  switch (type) {
    case 'product_added':
      return <PackagePlus size={size} />;
    case 'price_updated':
      return <Tag size={size} />;
    case 'stock_adjusted':
      return <Boxes size={size} />;
    case 'staff_signup':
      return <UserPlus size={size} />;
    default:
      return <PencilLine size={size} />;
  }
};

/** Renders the "what changed" detail of a notification (old → new price etc.) */
export function NotifDetail({ n }: { n: AppNotification }) {
  const d = n.data as Record<string, string | number | boolean | null>;
  if (n.type === 'price_updated')
    return (
      <div className="diff">
        <span className="diff-old">{fmtMoney(d.old_price as number)}</span>
        <ArrowRight size={14} />
        <span className="diff-new">{fmtMoney(d.new_price as number)}</span>
      </div>
    );
  if (n.type === 'stock_adjusted')
    return (
      <div className="diff">
        <span className="diff-old">{String(d.old_stock)}</span>
        <ArrowRight size={14} />
        <span className="diff-new">{String(d.new_stock)} in stock</span>
      </div>
    );
  if (n.type === 'product_added')
    return (
      <div className="diff-grid">
        <span>Price</span>
        <b>{fmtMoney(d.price as number)}</b>
        <span>Stock</span>
        <b>{String(d.stock)}</b>
        {d.word_code && (
          <>
            <span>Code</span>
            <b className="mono">{String(d.word_code)}</b>
          </>
        )}
      </div>
    );
  if (n.type === 'product_updated' && d.old_name !== d.new_name)
    return (
      <div className="diff">
        <span className="diff-old">{String(d.old_name)}</span>
        <ArrowRight size={14} />
        <span className="diff-new">{String(d.new_name)}</span>
      </div>
    );
  return null;
}

/** Floating pop-up cards in the corner for admins. */
export default function NotificationCards() {
  const { popups, dismissPopup, markRead } = useNotifications();
  const navigate = useNavigate();
  if (!popups.length) return null;

  return (
    <div className="notif-stack" aria-live="polite">
      {popups.map((n) => (
        <article key={n.id} className={`notif-card t-${n.type}`}>
          <div className="notif-icon">{notifIcon(n.type)}</div>
          <div className="notif-content">
            <header>
              <strong>{n.title}</strong>
              <time>{timeAgo(n.created_at)}</time>
            </header>
            <p>{n.message}</p>
            <NotifDetail n={n} />
            <div className="notif-actions">
              <button
                className="btn btn-primary btn-xs"
                onClick={() => {
                  markRead([n.id]);
                  navigate(n.type === 'staff_signup' ? '/staff' : '/notifications');
                }}
              >
                Review
              </button>
              <button className="btn btn-ghost btn-xs" onClick={() => markRead([n.id])}>
                <Check size={13} /> Mark read
              </button>
            </div>
          </div>
          <button className="icon-btn notif-close" onClick={() => dismissPopup(n.id)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}
