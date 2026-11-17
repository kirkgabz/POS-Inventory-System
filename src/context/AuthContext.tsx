import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { errorMessage, supabase } from '../lib/supabase';
import { failure, promptValue, success } from '../lib/alerts';
import type { Profile } from '../lib/types';

interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
  role: 'staff' | 'admin';
  adminCode?: string;
  inviteCode?: string;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  canManageProducts: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function askNewPassword() {
  const pw = await promptValue({
    title: 'Set a new password',
    text: 'Choose a new password for your account.',
    input: 'password',
    placeholder: 'At least 8 characters',
    confirmText: 'Save password',
    validate: (v) => (v.length < 8 ? 'Use at least 8 characters.' : null),
  });
  if (!pw) return;
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) failure('Could not update password', errorMessage(error));
  else success('Password updated', 'You are signed in.');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) return setProfile(null);
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // defer to avoid calling supabase inside the auth callback lock
      setTimeout(() => loadProfile(s?.user.id), 0);
      // Arrived from a "reset password" email → ask for the new password
      if (event === 'PASSWORD_RECOVERY') setTimeout(askNewPassword, 300);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // Live-update my own profile (e.g. the store owner grants access or deactivates me)
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`me-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        (payload) => setProfile(payload.new as Profile))
      .subscribe();
    const onFocus = () => loadProfile(uid);
    window.addEventListener('focus', onFocus);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener('focus', onFocus);
    };
  }, [uid, loadProfile]);

  const value = useMemo<AuthState>(() => {
    const active = !!profile?.is_active;
    return {
      session,
      profile,
      loading,
      isAdmin: active && profile?.role === 'admin',
      canManageProducts: active && (profile?.role === 'admin' || !!profile?.can_manage_products),
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUp({ fullName, email, password, role, adminCode, inviteCode }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: fullName,
              requested_role: role,
              admin_code: role === 'admin' ? adminCode : undefined,
              invite_code: role === 'staff' ? inviteCode : undefined,
            },
          },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        await supabase.auth.signOut();
        setProfile(null);
      },
      refreshProfile: () => loadProfile(session?.user.id),
    };
  }, [session, profile, loading, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
