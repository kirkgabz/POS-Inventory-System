import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { Ban, Copy, KeyRound, Link2, Loader2, Send, Share2, ShieldCheck, ShieldOff, Store, UserCheck, UserPlus, UserX, Wand2 } from 'lucide-react';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success, toast } from '../lib/alerts';
import { STORE_NAME, fmtDate, initials, timeAgo } from '../lib/format';
import { generateInviteCode, inviteLink } from '../lib/invites';
import type { Profile, StaffInvite } from '../lib/types';

const roleLabel = (r: Profile['role']) => (r === 'admin' ? 'Store owner' : 'Staff');

function inviteStatus(i: StaffInvite): { key: 'used' | 'revoked' | 'expired' | 'open'; label: string } {
  if (i.used_at) return { key: 'used', label: 'Joined' };
  if (i.revoked) return { key: 'revoked', label: 'Cancelled' };
  if (new Date(i.expires_at) < new Date()) return { key: 'expired', label: 'Expired' };
  return { key: 'open', label: 'Waiting' };
}

async function copyText(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    failure('Could not copy', 'Select the link and copy it manually.');
  }
}

export default function StaffPage() {
  const { profile: me } = useAuth();
  const { version } = useNotifications();
  const [people, setPeople] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [savedCode, setSavedCode] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareInvite, setShareInvite] = useState<StaffInvite | null>(null);

  const load = useCallback(async () => {
    const [{ data }, { data: s }, { data: inv }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('app_settings').select('admin_signup_code').eq('id', 1).maybeSingle(),
      supabase
        .from('staff_invites')
        .select('*, used_profile:profiles!staff_invites_used_by_fkey(full_name, email)')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    setPeople((data as Profile[]) ?? []);
    setInvites((inv as StaffInvite[]) ?? []);
    setCode(s?.admin_signup_code ?? '');
    setSavedCode(s?.admin_signup_code ?? '');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const update = async (p: Profile, patch: Partial<Profile>, confirm: { title: string; html: string; confirmText: string; danger?: boolean }, done: string) => {
    if (!(await confirmAction(confirm))) return;
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) return failure('Could not update', errorMessage(error));
    setPeople((l) => l.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    success(done, p.full_name);
  };

  const toggleAuthorize = (p: Profile) =>
    update(
      p,
      { can_manage_products: !p.can_manage_products },
      p.can_manage_products
        ? { title: 'Remove product access?', html: `<b>${p.full_name}</b> will no longer be able to add products or change prices.`, confirmText: 'Remove access', danger: true }
        : { title: 'Authorize this staff?', html: `<b>${p.full_name}</b> will be able to <b>add products manually</b>, generate codes, <b>update prices</b> and adjust stock.<br/><br/><small>You'll get a notification for every change they make.</small>`, confirmText: 'Authorize' },
      p.can_manage_products ? 'Access removed' : 'Staff authorized',
    );

  const revoke = async (i: StaffInvite) => {
    const ok = await confirmAction({
      title: 'Cancel this invitation?',
      html: `The link <span class="mono">${i.code}</span>${i.invited_name ? ` for <b>${i.invited_name}</b>` : ''} will stop working.`,
      confirmText: 'Cancel invitation',
      cancelText: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('staff_invites').update({ revoked: true }).eq('id', i.id);
    if (error) return failure('Could not cancel', errorMessage(error));
    setInvites((l) => l.map((x) => (x.id === i.id ? { ...x, revoked: true } : x)));
    success('Invitation cancelled');
  };

  const saveCode = async (value: string) => {
    const ok = await confirmAction({
      title: value ? 'Save store owner key?' : 'Turn off owner sign-ups?',
      html: value
        ? `Anyone with <b class="mono">${value}</b> can create a <b>store owner</b> account with full control. Share it only with co-owners.`
        : 'Nobody will be able to sign up as a store owner until you set a new key.',
      confirmText: value ? 'Save key' : 'Turn off',
      danger: !value,
    });
    if (!ok) return;
    const { error } = await supabase.from('app_settings').update({ admin_signup_code: value || null, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) return failure('Could not save', errorMessage(error));
    setSavedCode(value);
    setCode(value);
    success(value ? 'Owner key saved' : 'Owner sign-ups turned off');
  };

  const openInvites = invites.filter((i) => inviteStatus(i).key === 'open');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Store owner</span>
          <h1 className="display">Staff &amp; access</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>
          <UserPlus size={16} /> Invite staff
        </button>
      </header>

      {/* ---------- invitations ---------- */}
      <section className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">New staff join by invitation only</span>
            <h3 className="display">Invitations {openInvites.length > 0 && <span className="muted">· {openInvites.length} waiting</span>}</h3>
          </div>
          <Link2 size={18} className="muted" />
        </header>
        {loading ? (
          <div className="skeleton" style={{ height: 70 }} />
        ) : invites.length === 0 ? (
          <div className="invite-empty">
            <p className="muted small">
              No invitations yet. Click <b>Invite staff</b>, then send the link to your new staff member. They open it (or paste it on the sign-up page) to create
              their account.
            </p>
          </div>
        ) : (
          <div className="invites">
            {invites.map((i) => {
              const st = inviteStatus(i);
              return (
                <div key={i.id} className={`invite row-in st-${st.key}`}>
                  <span className={`invite-dot`} />
                  <div className="grow">
                    <strong>{i.invited_name || (st.key === 'used' ? i.used_profile?.full_name : 'Unnamed invitation')}</strong>
                    <div className="muted small">
                      <span className="mono">{i.code}</span>
                      {i.email && <> · {i.email}</>}
                      {' · '}
                      {st.key === 'used'
                        ? `joined ${timeAgo(i.used_at!)}${i.used_profile?.email ? ` as ${i.used_profile.email}` : ''}`
                        : st.key === 'open'
                          ? `expires ${fmtDate(i.expires_at)}`
                          : `created ${timeAgo(i.created_at)}`}
                    </div>
                  </div>
                  <span className={`tag invite-tag t-${st.key}`}>{st.label}</span>
                  {st.key === 'open' && (
                    <div className="row gap-sm">
                      <button className="btn btn-ghost btn-xs" onClick={() => setShareInvite(i)}>
                        <Send size={13} /> Share
                      </button>
                      <button className="icon-btn" title="Copy link" onClick={() => copyText(inviteLink(i.code), 'Invitation link copied')}>
                        <Copy size={15} />
                      </button>
                      <button className="icon-btn danger" title="Cancel invitation" onClick={() => revoke(i)}>
                        <Ban size={15} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- team ---------- */}
      <section className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">Team</span>
            <h3 className="display">Members</h3>
          </div>
        </header>
        {loading ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          <div className="people">
            {people.map((p) => (
              <div key={p.id} className={`person ${!p.is_active ? 'inactive' : ''}`}>
                <span className={`avatar ${p.role === 'admin' ? 'admin' : ''}`}>{initials(p.full_name)}</span>
                <div className="grow">
                  <strong>
                    {p.full_name} {p.id === me?.id && <span className="muted small">(you)</span>}
                  </strong>
                  <div className="muted small">
                    {p.email}
                    {!p.is_active && ' · deactivated'}
                  </div>
                </div>
                <span className={`tag ${p.role === 'admin' ? 'tag-dark' : ''}`}>{roleLabel(p.role)}</span>

                {p.role === 'staff' && (
                  <label className="switch" title="Can add products & update prices">
                    <input type="checkbox" checked={p.can_manage_products} onChange={() => toggleAuthorize(p)} disabled={!p.is_active} />
                    <i />
                    <span className="small">Product &amp; price access</span>
                  </label>
                )}

                {p.id !== me?.id && (
                  <div className="row gap-sm">
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() =>
                        update(
                          p,
                          { role: p.role === 'admin' ? 'staff' : 'admin', can_manage_products: p.role !== 'admin' },
                          p.role === 'admin'
                            ? { title: 'Make this person staff?', html: `<b>${p.full_name}</b> will no longer be a store owner.`, confirmText: 'Make staff', danger: true }
                            : { title: 'Make store owner?', html: `<b>${p.full_name}</b> will have full control, including staff, prices and reports.`, confirmText: 'Make store owner' },
                          'Role updated',
                        )
                      }
                    >
                      {p.role === 'admin' ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                      {p.role === 'admin' ? 'Make staff' : 'Make store owner'}
                    </button>
                    <button
                      className={`btn btn-xs ${p.is_active ? 'btn-ghost danger-text' : 'btn-ghost'}`}
                      onClick={() =>
                        update(
                          p,
                          { is_active: !p.is_active },
                          p.is_active
                            ? { title: 'Deactivate account?', html: `<b>${p.full_name}</b> won't be able to use the register.`, confirmText: 'Deactivate', danger: true }
                            : { title: 'Reactivate account?', html: `<b>${p.full_name}</b> will regain access.`, confirmText: 'Reactivate' },
                          p.is_active ? 'Account deactivated' : 'Account reactivated',
                        )
                      }
                    >
                      {p.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
                      {p.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- owner key ---------- */}
      <section className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">Security</span>
            <h3 className="display">Store owner key</h3>
          </div>
          <KeyRound size={18} className="muted" />
        </header>
        <p className="muted small">
          Only needed to add another <b>store owner</b> (e.g. a co-owner). They choose <b>Store owner</b> on the sign-up page and enter this key. Leave it empty
          to turn owner sign-ups off — you can still make an existing staff member a store owner above.
        </p>
        <div className="row gap-sm wrap" style={{ marginTop: 12 }}>
          <input className="input mono grow" value={code} onChange={(e) => setCode(e.target.value)} placeholder="No key — owner sign-ups are off" />
          <button className="btn btn-ghost" onClick={() => setCode(generateInviteCode().replace('TB-', 'OWN-'))}>
            <Wand2 size={14} /> Generate
          </button>
          {savedCode && (
            <button className="btn btn-ghost" onClick={() => copyText(savedCode, 'Key copied')}>
              <Copy size={14} />
            </button>
          )}
          <button className="btn btn-primary" disabled={code === savedCode} onClick={() => saveCode(code.trim())}>
            Save
          </button>
        </div>
      </section>

      <InviteForm
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={(i) => {
          setInvites((l) => [i, ...l]);
          setInviteOpen(false);
          setShareInvite(i);
        }}
      />
      <ShareInvite invite={shareInvite} onClose={() => setShareInvite(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function InviteForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (i: StaffInvite) => void }) {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setDays(7);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await confirmAction({
      title: 'Create invitation?',
      html:
        (name ? `For <b>${name}</b>` : 'A one-time staff invitation') +
        (email ? `<br/><span class="muted">Only <b>${email}</b> can use it.</span>` : '') +
        `<br/><small>Valid for ${days} day${days === 1 ? '' : 's'} · can be used once.</small>`,
      confirmText: 'Create link',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const expires = new Date(Date.now() + days * 86400000).toISOString();
      let created: StaffInvite | null = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        const { data, error } = await supabase
          .from('staff_invites')
          .insert({ code: generateInviteCode(), invited_name: name.trim() || null, email: email.trim().toLowerCase() || null, expires_at: expires, created_by: profile?.id })
          .select()
          .single();
        if (!error) created = data as StaffInvite;
        else if (!/duplicate key/.test(error.message)) throw error;
      }
      if (!created) throw new Error('Could not create a unique invitation. Please try again.');
      onCreated(created);
    } catch (err) {
      failure('Could not create invitation', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite staff"
      subtitle="Create a one-time link your new staff member uses to sign up."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button form="invite-form" className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />} Create link
          </button>
        </>
      }
    >
      <form id="invite-form" className="stack" onSubmit={submit}>
        <label className="field">
          <span>Staff name (optional)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Maria Santos" />
        </label>
        <label className="field">
          <span>
            Their email <small className="muted">(optional — locks the link to this email)</small>
          </span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@gmail.com" />
        </label>
        <div className="field">
          <span>Link expires after</span>
          <div className="seg seg-3">
            {[1, 3, 7].map((d) => (
              <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                {d} day{d === 1 ? '' : 's'}
              </button>
            ))}
            <i className="seg-pill" style={{ transform: `translateX(${[1, 3, 7].indexOf(days) * 100}%)` }} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ShareInvite({ invite, onClose }: { invite: StaffInvite | null; onClose: () => void }) {
  const [qr, setQr] = useState('');
  const link = invite ? inviteLink(invite.code) : '';

  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#141414', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [link]);

  if (!invite) return null;
  const message = `Hi${invite.invited_name ? ` ${invite.invited_name}` : ''}! You're invited to join ${STORE_NAME} as staff. Create your account here: ${link}`;

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${STORE_NAME}`, text: message, url: link });
      } catch {
        /* cancelled */
      }
    } else copyText(message, 'Invitation message copied');
  };

  return (
    <Modal open onClose={onClose} title="Invitation ready" subtitle={invite.invited_name ? `For ${invite.invited_name}` : 'One-time staff invitation'}>
      <div className="share-invite">
        {qr && <img src={qr} alt="Invitation QR code" className="share-qr" />}
        <p className="muted small center">They can scan this with their phone camera, or you can send the link below.</p>
        <div className="share-link">
          <span className="mono">{link}</span>
          <button className="btn btn-primary btn-sm" onClick={() => copyText(link, 'Invitation link copied')}>
            <Copy size={14} /> Copy
          </button>
        </div>
        <div className="row gap-sm center wrap">
          <button className="btn btn-ghost btn-sm" onClick={share}>
            <Share2 size={14} /> Share…
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => copyText(message, 'Invitation message copied')}>
            <Send size={14} /> Copy message
          </button>
        </div>
        <p className="muted small center">
          <Store size={12} style={{ verticalAlign: '-2px' }} /> Code <span className="mono">{invite.code}</span> · expires {fmtDate(invite.expires_at)}
          {invite.email && <> · only for {invite.email}</>}
        </p>
      </div>
    </Modal>
  );
}
