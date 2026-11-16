import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { isSupabaseConfigured } from './lib/supabase';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import PendingPage from './pages/PendingPage';
import DashboardPage from './pages/DashboardPage';
import PosPage from './pages/PosPage';
import ProductsPage from './pages/ProductsPage';
import SalesPage from './pages/SalesPage';
import StaffPage from './pages/StaffPage';
import NotificationsPage from './pages/NotificationsPage';
import type { ReactNode } from 'react';

function Splash() {
  return (
    <div className="center-screen">
      <div className="splash">
        <span className="brand-mark lg">J</span>
        <div className="splash-bar" />
      </div>
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

function Gate() {
  const { session, profile, loading } = useAuth();
  if (!isSupabaseConfigured) return <SetupNotice />;
  if (loading || (session && !profile)) return <Splash />;
  if (!session) return <AuthPage />;
  if (!profile!.is_active) return <PendingPage />;

  return (
    <NotificationProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="pos" element={<PosPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="staff" element={<AdminOnly><StaffPage /></AdminOnly>} />
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
