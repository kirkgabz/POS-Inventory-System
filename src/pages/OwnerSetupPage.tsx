import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { ArrowRight, KeyRound, Loader2, MailCheck, RotateCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errorMessage, supabase } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { BRAND, BRAND_INITIAL } from '../lib/format';
import { clearOAuthIntent } from '../lib/oauth';
import './signin.css';

const LEN = 6;
const RESEND_SECONDS = 60;

/**
 * Shown after "Create account → Store owner → Continue with Google".
 * The owner proves the Google email with a 6-digit code, then (unless this
 * is a brand-new store) enters the store owner key.
 */
export default function OwnerSetupPage() {
  const { session, refreshProfile, signOut } = useAuth();
  const email = session?.user.email ?? '';
  const [needsKey, setNeedsKey] = useState<boolean | null>(null);
  const [ownerKey, setOwnerKey] = useState('');
  const [sent, setSent] = useState(false);
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(''));
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    supabase.rpc('owner_setup_needs_key').then(({ data }) => setNeedsKey(!!data));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setBusy('send');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(null);
    if (error) return failure('Could not send the code', errorMessage(error));
    setSent(true);
    setCooldown(RESEND_SECONDS);
    setDigits(Array(LEN).fill(''));
    setTimeout(() => boxes.current[0]?.focus(), 50);
    success('Code sent', `Check ${email} for your 6-digit code.`, 2200);
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setDigits((cur) => {
      const next = cur.slice();
      next[i] = d;
      return next;
    });
    if (d && i < LEN - 1) boxes.current[i + 1]?.focus();
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < LEN - 1) boxes.current[i + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const code = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LEN);
    if (!code) return;
    e.preventDefault();
    setDigits(Array.from({ length: LEN }, (_, i) => code[i] ?? ''));
    boxes.current[Math.min(code.length, LEN - 1)]?.focus();
  };

  const code = digits.join('');

  const verify = async () => {
    if (code.length !== LEN) return failure('Enter the 6-digit code', 'Type or paste the code from your email.');
    if (needsKey && !ownerKey.trim()) return failure('Store owner key needed', 'Ask the current store owner for the key.');
    setBusy('verify');
    try {
      const { error: otpErr } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (otpErr) throw otpErr;
      const { error } = await supabase.rpc('complete_owner_setup', { p_owner_key: needsKey ? ownerKey.trim() : null });
      if (error) throw error;
      clearOAuthIntent();
      await refreshProfile();
      success('You are the store owner', 'Your store is ready.');
    } catch (err) {
      failure('Could not verify', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    const ok = await confirmAction({
      title: 'Cancel store owner sign-up?',
      text: 'Your Google sign-up will be removed and you will return to the sign-in page.',
      confirmText: 'Cancel sign-up',
      cancelText: 'Keep going',
      danger: true,
    });
    if (!ok) return;
    await supabase.rpc('discard_my_account');
    clearOAuthIntent();
    await signOut();
  };

  return (
    <div className="signin enter">
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
            <span className="signin-tag">Store owner setup</span>
          </div>
        </header>

        <div className="signin-card">
          <div className="signin-head">
            <span className="otp-icon">{sent ? <MailCheck size={22} /> : <ShieldCheck size={22} />}</span>
            <h1>Verify it's you</h1>
            <p>
              {sent ? (
                <>
                  We sent a 6-digit code to <b>{email}</b>. Enter it below.
                </>
              ) : (
                <>
                  To finish creating your <b>store owner</b> account, we'll email a 6-digit code to <b>{email}</b>.
                </>
              )}
            </p>
          </div>

          {needsKey && (
            <label className="sf">
              <span>Store owner key</span>
              <div className="sf-box">
                <KeyRound size={17} />
                <input className="mono" value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)} placeholder="Key set by the current store owner" autoComplete="off" />
              </div>
              <small>This store already has an owner — ask them for the key.</small>
            </label>
          )}

          {sent ? (
            <>
              <div className="otp" onPaste={onPaste}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (boxes.current[i] = el)}
                    value={d}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    aria-label={`Digit ${i + 1}`}
                    className={d ? 'filled' : ''}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onKey(i, e)}
                    onPaste={onPaste}
                  />
                ))}
              </div>
              <button className="signin-cta" onClick={verify} disabled={busy !== null || code.length !== LEN}>
                {busy === 'verify' ? <Loader2 size={18} className="spin" /> : null}
                <span>Verify &amp; create store</span>
                {busy !== 'verify' && <ArrowRight size={18} />}
              </button>
              <button type="button" className="signin-link otp-resend" onClick={sendCode} disabled={cooldown > 0 || busy !== null}>
                <RotateCw size={13} /> {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
            </>
          ) : (
            <button className="signin-cta" onClick={sendCode} disabled={busy !== null || needsKey === null}>
              {busy === 'send' ? <Loader2 size={18} className="spin" /> : null}
              <span>Send 6-digit code</span>
              {busy !== 'send' && <ArrowRight size={18} />}
            </button>
          )}
        </div>

        <footer className="signin-foot">
          <button type="button" onClick={cancel}>
            Cancel and go back
          </button>
        </footer>
      </main>
    </div>
  );
}
