import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, ShieldCheck, ShieldOff, UserCheck, UserX, Wand2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success, toast } from '../lib/alerts';
import { fmtDate, initials } from '../lib/format';
import type { Profile } from '../lib/types';

export default function StaffPage() {
  const { profile: me } = useAuth();
  const { version } = useNotifications();
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [savedCode, setSavedCode] = useState('');

  const load = useCallback(async () => {
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('app_settings').select('admin_signup_code').eq('id', 1).maybeSingle(),
    ]);
    setPeople((data as Profile[]) ?? []);
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

  const saveCode = async (value: string) => {
    const ok = await confirmAction({
      title: value ? 'Save admin invite key?' : 'Disable admin sign-ups?',
      html: value ? `Anyone with <b class="mono">${value}</b> can create an admin account. Share it carefully.` : 'Nobody will be able to sign up as admin until you set a new key.',
      confirmText: value ? 'Save key' : 'Disable',
      danger: !value,
    });
    if (!ok) return;
    const { error } = await supabase.from('app_settings').update({ admin_signup_code: value || null, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) return failure('Could not save', errorMessage(error));
    setSavedCode(value);
    setCode(value);
    success(value ? 'Invite key saved' : 'Admin sign-ups disabled');
  };

  const pending = people.filter((p) => !p.is_active && p.role === 'staff');
  const active = people.filter((p) => p.is_active || p.role === 'admin');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Admin</span>
          <h1 className="display">Staff &amp; access</h1>
        </div>
      </header>

      {pending.length > 0 && (
        <section className="card pending-list reveal">
          <header className="card-head">
            <div>
              <span className="eyebrow">Waiting for you</span>
              <h3 className="display">Pending approvals · {pending.length}</h3>
            </div>
          </header>
          {pending.map((p) => (
            <div key={p.id} className="person">
              <span className="avatar">{initials(p.full_name)}</span>
              <div className="grow">
                <strong>{p.full_name}</strong>
                <div className="muted small">
                  {p.email} · signed up {fmtDate(p.created_at)}
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() =>
                  update(p, { is_active: true }, { title: 'Approve this staff?', html: `<b>${p.full_name}</b> will be able to use the register.`, confirmText: 'Approve' }, 'Staff approved')
                }
              >
                <UserCheck size={14} /> Approve
              </button>
            </div>
          ))}
        </section>
      )}

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
            {active.map((p) => (
              <div key={p.id} className={`person ${!p.is_active ? 'inactive' : ''}`}>
                <span className={`avatar ${p.role === 'admin' ? 'admin' : ''}`}>{initials(p.full_name)}</span>
                <div className="grow">
                  <strong>
                    {p.full_name} {p.id === me?.id && <span className="muted small">(you)</span>}
                  </strong>
                  <div className="muted small">{p.email}</div>
                </div>
                <span className={`tag ${p.role === 'admin' ? 'tag-dark' : ''}`}>{p.role}</span>

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
                            ? { title: 'Make staff?', html: `<b>${p.full_name}</b> will lose admin rights.`, confirmText: 'Demote', danger: true }
                            : { title: 'Make admin?', html: `<b>${p.full_name}</b> will have full control, including staff management.`, confirmText: 'Make admin' },
                          'Role updated',
                        )
                      }
                    >
                      {p.role === 'admin' ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                      {p.role === 'admin' ? 'Make staff' : 'Make admin'}
                    </button>
                    <button
                      className={`btn btn-xs ${p.is_active ? 'btn-ghost danger-text' : 'btn-ghost'}`}
                      onClick={() =>
                        update(
                          p,
                          { is_active: !p.is_active },
                          p.is_active
                            ? { title: 'Deactivate account?', html: `<b>${p.full_name}</b> won't be able to sign in to the register.`, confirmText: 'Deactivate', danger: true }
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

      <section className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">Security</span>
            <h3 className="display">Admin invite key</h3>
          </div>
          <KeyRound size={18} className="muted" />
        </header>
        <p className="muted small">
          New people signing up as <b>Admin</b> must enter this key. Leave empty to disable admin sign-ups (you can still promote staff above).
        </p>
        <div className="row gap-sm wrap" style={{ marginTop: 12 }}>
          <input className="input mono grow" value={code} onChange={(e) => setCode(e.target.value)} placeholder="No key — admin sign-ups disabled" />
          <button className="btn btn-ghost" onClick={() => setCode(Math.random().toString(36).slice(2, 8).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase())}>
            <Wand2 size={14} /> Generate
          </button>
          {savedCode && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                navigator.clipboard?.writeText(savedCode);
                toast('Key copied');
              }}
            >
              <Copy size={14} />
            </button>
          )}
          <button className="btn btn-primary" disabled={code === savedCode} onClick={() => saveCode(code.trim())}>
            Save
          </button>
        </div>
      </section>
    </div>
  );
}
