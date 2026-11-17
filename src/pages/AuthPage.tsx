import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Play, ShieldCheck, User, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { enabledProviders, errorMessage, isSupabaseConfigured, rememberMe, supabase } from '../lib/supabase';
import { failure, info, promptValue, success } from '../lib/alerts';
import { BRAND, BRAND_INITIAL, STORE_NAME } from '../lib/format';
import StoreIntro from '../components/StoreIntro';
import './signin.css';

type Mode = 'signin' | 'signup';
type Provider = 'google' | 'apple';
const INTRO_KEY = 'jen-intro-seen';

/** Play the intro once per browser session (never for reduced-motion users; `?intro` forces it). */
function shouldPlayIntro() {
  try {
    if (new URLSearchParams(window.location.search).has('intro')) return true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return sessionStorage.getItem(INTRO_KEY) !== '1';
  } catch {
    return true;
  }
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
const AppleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden fill="currentColor">
    <path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.89 1.15 9.14.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.39-.92-2.41-3.65zM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.96 2.79 1.02.08 2.05-.52 2.68-1.27z" />
  </svg>
);

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [mode, setMode] = useState<Mode>('signin');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [remember, setRemember] = useState(rememberMe.get());
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<{ google: boolean; apple: boolean } | null>(null);

  useEffect(() => {
    if (isSupabaseConfigured) enabledProviders().then(setSso);
  }, []);

  const endIntro = () => {
    try {
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* ignore */
    }
    setIntro(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      failure('Supabase is not configured', 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        rememberMe.set(remember);
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

  const forgot = async () => {
    const addr = await promptValue({
      title: 'Reset your password',
      text: 'Enter your account email and we will send you a reset link.',
      input: 'email',
      value: email,
      placeholder: 'you@store.com',
      confirmText: 'Send reset link',
      validate: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'Enter a valid email address.'),
    });
    if (!addr) return;
    const { error } = await supabase.auth.resetPasswordForEmail(addr.trim(), { redirectTo: window.location.origin });
    if (error) return failure('Could not send the link', errorMessage(error));
    success('Check your email', `If ${addr} has an account, a reset link is on its way.`, 2600);
  };

  const social = async (provider: Provider) => {
    if (!sso?.[provider]) {
      info(
        `${provider === 'google' ? 'Google' : 'Apple'} sign-in isn't set up yet`,
        `An admin can turn it on in Supabase → Authentication → Sign In / Providers → ${provider === 'google' ? 'Google' : 'Apple'}.<br/><br/>Until then, please use your email and password.`,
      );
      return;
    }
    rememberMe.set(remember);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    if (error) failure('Could not continue', errorMessage(error));
  };


  return (
    <>
      {intro && <StoreIntro onDone={endIntro} />}

      <div className={`signin ${intro ? 'waiting' : 'enter'}`}>
        {/* soft pastel aurora — same palette as the intro */}
        <div className="signin-bg" aria-hidden>
          <span className="signin-glow g1" />
          <span className="signin-glow g2" />
          <span className="signin-glow g3" />
        </div>

        <main className="signin-main">
          <header className="signin-brand">
            <span className="signin-mark">{BRAND_INITIAL}</span>
            <div>
              <div className="signin-name">
                {BRAND.first}
                <em>{BRAND.second}</em>
              </div>
              <span className="signin-tag">Point of sale · Inventory</span>
            </div>
          </header>

          <form className="signin-card" onSubmit={submit} noValidate={false}>
            <div className="signin-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>
                Sign in
              </button>
              <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
                Create account
              </button>
              <i className={mode === 'signup' ? 'right' : ''} />
            </div>

            <div className="signin-head" key={mode}>
              <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
              <p>{mode === 'signin' ? 'Sign in to open the register.' : 'Staff accounts are approved by an admin.'}</p>
            </div>

            {mode === 'signup' && (
              <>
                <div className="signin-roles">
                  <button type="button" className={role === 'staff' ? 'on' : ''} onClick={() => setRole('staff')}>
                    <UserRound size={18} />
                    <strong>Staff</strong>
                    <span>Needs approval</span>
                  </button>
                  <button type="button" className={role === 'admin' ? 'on' : ''} onClick={() => setRole('admin')}>
                    <ShieldCheck size={18} />
                    <strong>Admin</strong>
                    <span>Invite key</span>
                  </button>
                </div>
                <label className="sf">
                  <span>Full name</span>
                  <div className="sf-box">
                    <User size={17} />
                    <input required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Juan Dela Cruz" />
                  </div>
                </label>
              </>
            )}

            <label className="sf">
              <span>Email</span>
              <div className="sf-box">
                <Mail size={17} />
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@store.com" />
              </div>
            </label>

            <label className="sf">
              <span>Password</span>
              <div className="sf-box">
                <Lock size={17} />
                <input
                  type={show ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
                />
                <button type="button" className="sf-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            {mode === 'signup' && role === 'admin' && (
              <label className="sf">
                <span>Admin invite key</span>
                <div className="sf-box">
                  <KeyRound size={17} />
                  <input value={adminCode} onChange={(e) => setAdminCode(e.target.value)} placeholder="Ask the store owner" className="mono" />
                </div>
                <small>The very first account becomes admin automatically — no key needed.</small>
              </label>
            )}

            {mode === 'signin' && (
              <div className="signin-row">
                <label className="signin-check">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <i />
                  Remember me
                </label>
                <button type="button" className="signin-link" onClick={forgot}>
                  Forgot password?
                </button>
              </div>
            )}

            <button className="signin-cta" disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : null}
              <span>{mode === 'signin' ? 'Sign in' : 'Create account'}</span>
              {!busy && <ArrowRight size={18} />}
            </button>

            <div className="signin-or">
              <span>or continue with</span>
            </div>
            <div className="signin-sso">
              <button type="button" onClick={() => social('google')}>
                <GoogleIcon /> Google
              </button>
              <button type="button" onClick={() => social('apple')}>
                <AppleIcon /> Apple
              </button>
            </div>
          </form>

          <footer className="signin-foot">
            <button type="button" onClick={() => setIntro(true)}>
              <Play size={12} /> Replay intro
            </button>
            <span>
              © {new Date().getFullYear()} {STORE_NAME}
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}
