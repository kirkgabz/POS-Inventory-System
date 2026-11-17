import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Link2, Loader2, Lock, Mail, Store, User, UserRound, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { enabledProviders, errorMessage, isSupabaseConfigured, rememberMe, supabase } from '../lib/supabase';
import { confirmAction, failure, info, promptValue, success } from '../lib/alerts';
import { BRAND, STORE_NAME } from '../lib/format';
import { LogoMark } from '../components/Logo';
import StoreIntro from '../components/StoreIntro';
import { continueWithGoogle, type OAuthIntent } from '../lib/oauth';
import { checkInvite, inviteReasonText, parseInvite, type InviteCheck } from '../lib/invites';
import './signin.css';

type Mode = 'signin' | 'signup';
const INTRO_KEY = 'jen-intro-seen';
const urlInvite = () => {
  try {
    return new URLSearchParams(window.location.search).get('invite') ?? '';
  } catch {
    return '';
  }
};

/** Play the intro once per browser session (never for reduced-motion users; `?intro` forces it). */
function shouldPlayIntro() {
  try {
    if (new URLSearchParams(window.location.search).has('intro')) return true;
    if (urlInvite()) return false; // opened an invitation link → straight to the form
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

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [mode, setMode] = useState<Mode>(() => (urlInvite() ? 'signup' : 'signin'));
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [invite, setInvite] = useState(urlInvite);
  const [inviteCheck, setInviteCheck] = useState<{ state: 'idle' | 'checking' | 'done'; result?: InviteCheck }>({ state: 'idle' });
  const [remember, setRemember] = useState(rememberMe.get());
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState<boolean | null>(null);

  useEffect(() => {
    if (isSupabaseConfigured) enabledProviders().then((p) => setGoogleOn(p.google));
  }, []);

  // Check the invitation as it is pasted / typed (debounced)
  useEffect(() => {
    const code = parseInvite(invite);
    if (code.length < 8) return setInviteCheck({ state: 'idle' });
    setInviteCheck({ state: 'checking' });
    const t = setTimeout(async () => {
      const result = await checkInvite(code);
      setInviteCheck({ state: 'done', result });
      if (result.valid) {
        if (result.email) setEmail(result.email);
        if (result.invited_name) setFullName((n) => n || result.invited_name!);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [invite]);

  const inviteOk = inviteCheck.state === 'done' && !!inviteCheck.result?.valid;

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
        if (role === 'staff' && !inviteOk) throw new Error('Paste the invitation link from your store owner first.');
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const { needsConfirmation } = await signUp({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          role,
          adminCode,
          inviteCode: parseInvite(invite),
        });
        try {
          window.history.replaceState(null, '', window.location.pathname);
        } catch {
          /* ignore */
        }
        if (needsConfirmation) {
          await info(
            'Check your email',
            `We sent a confirmation link to <b>${email}</b>. Confirm it, then sign in.`,
          );
          setMode('signin');
        } else {
          success('Account created', role === 'staff' ? 'Welcome to the team!' : 'Your store is ready.');
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

  const google = async (intent: OAuthIntent) => {
    if (!googleOn) {
      info(
        "Google sign-in isn't set up yet",
        'The store owner can turn it on in Supabase → Authentication → Sign In / Providers → Google.<br/><br/>Until then, please use your email and password.',
      );
      return;
    }
    if (intent === 'owner') {
      const ok = await confirmAction({
        title: 'Create a store owner account with Google?',
        html: 'After choosing your Google account we will email you a <b>6-digit code</b> to confirm it is you.',
        confirmText: 'Continue with Google',
      });
      if (!ok) return;
    }
    const { error } = await continueWithGoogle(intent, remember);
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
            <LogoMark size={54} className="signin-logo" />
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
              <p>
                {mode === 'signin'
                  ? 'Sign in to open the register.'
                  : role === 'staff'
                    ? 'New staff join with an invitation link from the store owner.'
                    : 'Set up the store as its owner.'}
              </p>
            </div>

            {mode === 'signup' && (
              <>
                <div className="signin-roles">
                  <button type="button" className={role === 'staff' ? 'on' : ''} onClick={() => setRole('staff')}>
                    <UserRound size={18} />
                    <strong>Staff</strong>
                    <span>Invitation link</span>
                  </button>
                  <button type="button" className={role === 'admin' ? 'on' : ''} onClick={() => setRole('admin')}>
                    <Store size={18} />
                    <strong>Store owner</strong>
                    <span>Owner key</span>
                  </button>
                </div>

                {role === 'admin' && (
                  <>
                    <button type="button" className="signin-google" onClick={() => google('owner')}>
                      <GoogleIcon /> Continue with Google
                      <small>+ 6-digit email code</small>
                    </button>
                    <div className="signin-or">
                      <span>or create with email</span>
                    </div>
                  </>
                )}

                {role === 'staff' && (
                  <label className="sf">
                    <span>Invitation link</span>
                    <div className={`sf-box ${inviteOk ? 'ok' : inviteCheck.state === 'done' ? 'bad' : ''}`}>
                      <Link2 size={17} />
                      <input
                        required
                        value={invite}
                        onChange={(e) => setInvite(e.target.value)}
                        onPaste={(e) => {
                          e.preventDefault();
                          setInvite(parseInvite(e.clipboardData.getData('text')));
                        }}
                        placeholder="Paste the link your store owner sent you"
                        className="mono"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <span className="sf-status">
                        {inviteCheck.state === 'checking' && <Loader2 size={17} className="spin" />}
                        {inviteOk && <CheckCircle2 size={18} />}
                        {inviteCheck.state === 'done' && !inviteOk && <XCircle size={18} />}
                      </span>
                    </div>
                    {inviteOk ? (
                      <small className="sf-good">
                        Valid invitation{inviteCheck.result?.owner ? ` from ${inviteCheck.result.owner}` : ''}
                        {inviteCheck.result?.email ? ` · for ${inviteCheck.result.email}` : ''}
                      </small>
                    ) : inviteCheck.state === 'done' ? (
                      <small className="sf-bad">{inviteReasonText[inviteCheck.result?.reason ?? 'not_found']}</small>
                    ) : (
                      <small>Don't have one? Ask the store owner to send you an invitation link.</small>
                    )}
                  </label>
                )}

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
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={mode === 'signup' && role === 'staff' && inviteOk && !!inviteCheck.result?.email}
                  placeholder="you@store.com"
                />
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
                <span>Store owner key</span>
                <div className="sf-box">
                  <KeyRound size={17} />
                  <input value={adminCode} onChange={(e) => setAdminCode(e.target.value)} placeholder="Key set by the current store owner" className="mono" />
                </div>
                <small>Setting up a brand-new store? The very first account becomes the store owner automatically — no key needed.</small>
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

            <button className="signin-cta" disabled={busy || (mode === 'signup' && role === 'staff' && !inviteOk)}>
              {busy ? <Loader2 size={18} className="spin" /> : null}
              <span>{mode === 'signin' ? 'Sign in' : 'Create account'}</span>
              {!busy && <ArrowRight size={18} />}
            </button>

            {mode === 'signin' && (
            <>
            <div className="signin-or">
              <span>or continue with</span>
            </div>
            <button type="button" className="signin-google" onClick={() => google('signin')}>
              <GoogleIcon /> Continue with Google
            </button>
            </>
            )}
          </form>

          <footer className="signin-foot">
            <span>
              © {new Date().getFullYear()} {STORE_NAME}
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}
