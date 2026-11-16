import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errorMessage, isSupabaseConfigured } from '../lib/supabase';
import { failure, info, success } from '../lib/alerts';
import { STORE_NAME } from '../lib/format';

type Mode = 'signin' | 'signup';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      failure('Supabase is not configured', 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        success('Welcome back!', undefined, 1200);
      } else {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const { needsConfirmation } = await signUp({ fullName: fullName.trim(), email: email.trim(), password, role, adminCode });
        if (needsConfirmation) {
          await info(
            'Check your email',
            `We sent a confirmation link to <b>${email}</b>. Confirm it, then sign in.` +
              (role === 'staff' ? '<br/><br/>An admin will also need to approve your account.' : ''),
          );
          setMode('signin');
        } else {
          success('Account created', role === 'staff' ? 'An admin will approve your access shortly.' : undefined);
        }
      }
    } catch (err) {
      failure(mode === 'signin' ? 'Sign in failed' : 'Sign up failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-art" aria-hidden>
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
        <div className="auth-art-copy">
          <span className="eyebrow light">Est. with love</span>
          <h1 className="display">
            {STORE_NAME.split(' ')[0]}
            <em> {STORE_NAME.split(' ').slice(1).join(' ') || 'Store'}</em>
          </h1>
          <p>Sell, scan and keep count — quietly, beautifully.</p>
        </div>
        <svg className="auth-lines" viewBox="0 0 400 120" preserveAspectRatio="none">
          {Array.from({ length: 34 }).map((_, i) => (
            <rect key={i} x={i * 12} y={0} width={(i * 7) % 3 === 0 ? 5 : 2} height={120} rx={1} />
          ))}
        </svg>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="seg">
            <button type="button" className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>
              Sign in
            </button>
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
              Create account
            </button>
            <i className={`seg-pill ${mode === 'signup' ? 'right' : ''}`} />
          </div>

          <h2 className="display auth-title">{mode === 'signin' ? 'Good to see you.' : 'Join the counter.'}</h2>
          <p className="muted">
            {mode === 'signin' ? 'Sign in to open the register.' : 'Create a staff or admin account.'}
          </p>

          {mode === 'signup' && (
            <>
              <div className="role-pick">
                <button type="button" className={role === 'staff' ? 'on' : ''} onClick={() => setRole('staff')}>
                  <UserRound size={18} />
                  <strong>Staff</strong>
                  <span>Needs admin approval</span>
                </button>
                <button type="button" className={role === 'admin' ? 'on' : ''} onClick={() => setRole('admin')}>
                  <ShieldCheck size={18} />
                  <strong>Admin</strong>
                  <span>Requires invite key</span>
                </button>
              </div>
              <label className="field">
                <span>Full name</span>
                <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jen Dela Cruz" />
              </label>
            </>
          )}

          <label className="field">
            <span>Email</span>
            <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@store.com" />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="input-wrap">
              <input
                className="input"
                type={show ? 'text' : 'password'}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button type="button" className="input-icon" onClick={() => setShow((s) => !s)} aria-label="Toggle password">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {mode === 'signup' && role === 'admin' && (
            <label className="field reveal">
              <span>Admin invite key</span>
              <div className="input-wrap">
                <input className="input mono" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} placeholder="Ask the store owner" />
                <KeyRound size={16} className="input-icon static" />
              </div>
              <small className="muted">The very first account is automatically the admin — no key needed.</small>
            </label>
          )}

          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </section>
    </div>
  );
}
