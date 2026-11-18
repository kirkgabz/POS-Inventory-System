import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { useEffect } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { STORE_NAME } from './lib/format';
import { LogoLoader } from './components/Logo';
import { failure } from './lib/alerts';
import { clearOAuthIntent, getOAuthIntent } from './lib/oauth';
import OwnerSetupPage from './pages/OwnerSetupPage';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import PendingPage from './pages/PendingPage';
import DashboardPage from './pages/DashboardPage';
import PosPage from './pages/PosPage';
import ProductsPage from './pages/ProductsPage';
import SalesPage from './pages/SalesPage';
import StaffPage from './pages/StaffPage';
import NotificationsPage from './pages/NotificationsPage';
import PaymentsPage from './pages/PaymentsPage';
import DtrPage from './pages/DtrPage';
import ReceiptSettingsPage from './pages/ReceiptSettingsPage';
import ActivityPage from './pages/ActivityPage';
import type { ReactNode } from 'react';

function Splash() {
  return (
    <div className="center-screen">
      <LogoLoader size={76} />
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="center-screen">
      <div className="card pending-card">
        <h1 className="display">Connect Supabase</h1>
        <p className="muted">
          Create <code>.env.local</code> with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, run{' '}
          <code>supabase/schema.sql</code> in the SQL editor, then restart <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

/** Signed in with Google but there is no TapBenta account for that email. */
function NoGoogleAccount() {
  const { session, signOut } = useAuth();
  useEffect(() => {
    const email = session?.user.email ?? 'this Google account';
    (async () => {
      await supabase.rpc('discard_my_account');
      clearOAuthIntent();
      await signOut();
      failure(
        'No account found',
        `There is no ${STORE_NAME} account for ${email}. Staff need an invitation link from the store owner to create one.`,
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Splash />;
}

function Gate() {
  const { session, profile, loading } = useAuth();
  if (!isSupabaseConfigured) return <SetupNotice />;
  if (loading || (session && !profile)) return <Splash />;
  if (!session) return <AuthPage />;
  if (profile!.setup_pending) return getOAuthIntent() === 'owner' ? <OwnerSetupPage /> : <NoGoogleAccount />;
  if (!profile!.is_active) return <PendingPage />;

  return (
    <NotificationProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="pos" element={<PosPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="dtr" element={<DtrPage />} />
          <Route path="activity" element={<AdminOnly><ActivityPage /></AdminOnly>} />
          <Route path="staff" element={<AdminOnly><StaffPage /></AdminOnly>} />
          <Route path="payments" element={<AdminOnly><PaymentsPage /></AdminOnly>} />
          <Route path="receipt" element={<AdminOnly><ReceiptSettingsPage /></AdminOnly>} />
          <Route path="notifications" element={<AdminOnly><NotificationsPage /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </NotificationProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
