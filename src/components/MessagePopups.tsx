import { useNavigate } from 'react-router-dom';
import { BellRing, MessageSquareText, Reply, X } from 'lucide-react';
import { useMessages } from '../context/MessageContext';
import { timeAgo } from '../lib/format';
import { dueLabel } from '../lib/messages';

/** Floating cards (top-right) when a message, reminder or reply arrives. */
export default function MessagePopups() {
  const { popups, dismissPopup } = useMessages();
  const navigate = useNavigate();
  if (!popups.length) return null;

  return (
    <div className="msg-stack" aria-live="polite">
      {popups.map((m) => {
        const reminder = m.kind === 'reminder';
        const reply = !!m.parent_id;
        const due = reminder ? dueLabel(m.due_at) : null;
        return (
          <article key={m.id} className={`notif-card msg-pop ${reminder ? 'is-reminder' : ''} ${m.important ? 'is-important' : ''}`}>
            <div className="notif-icon">{reminder ? <BellRing size={18} /> : reply ? <Reply size={18} /> : <MessageSquareText size={18} />}</div>
            <div className="notif-content">
              <header>
                <strong>{reminder ? 'Reminder' : reply ? 'New reply' : 'New message'}</strong>
                <time>{timeAgo(m.created_at)}</time>
              </header>
              <p>
                <b>{m.sender_name}</b>
                {m.title ? ` · ${m.title}` : ''}
              </p>
              <p className="msg-pop-body">{m.body}</p>
              {due && <span className={`due-chip ${due.overdue ? 'over' : ''}`}>{due.text}</span>}
              <div className="notif-actions">
                <button
                  className="btn btn-primary btn-xs"
                  onClick={() => {
                    dismissPopup(m.id);
                    navigate(`/messages?open=${m.parent_id ?? m.id}`);
                  }}
                >
                  Open
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => dismissPopup(m.id)}>
                  Later
                </button>
              </div>
            </div>
            <button className="icon-btn notif-close" onClick={() => dismissPopup(m.id)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </article>
        );
      })}
    </div>
  );
}
