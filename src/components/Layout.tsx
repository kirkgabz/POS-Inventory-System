import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Clock3,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Printer,
  ReceiptText,
  ScanLine,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { confirmAction, toast } from '../lib/alerts';
import { BRAND, initials } from '../lib/format';
import { LogoMark } from './Logo';
import NotificationCards from './NotificationCards';

export default function Layout() {
  const { profile, isAdmin, canManageProducts, signOut } = useAuth();
  const { unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  const links = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, show: true, end: true },
    { to: '/pos', label: 'Point of Sale', icon: ScanLine, show: true },
    { to: '/products', label: 'Inventory', icon: Package, show: true },
    { to: '/sales', label: 'Sales', icon: ReceiptText, show: true },
    { to: '/dtr', label: 'Time clock', icon: Clock3, show: true },
    { to: '/activity', label: 'Inventory log', icon: History, show: isAdmin },
    { to: '/staff', label: 'Staff & Access', icon: Users, show: isAdmin },
    { to: '/payments', label: 'Payment accounts', icon: Wallet, show: isAdmin },
    { to: '/receipt', label: 'Receipt & invoice', icon: Printer, show: isAdmin },
    { to: '/notifications', label: 'Notifications', icon: Bell, show: isAdmin, badge: unread },
  ];

  const handleSignOut = async () => {
    if (await confirmAction({ title: 'Sign out?', text: 'You will need to sign in again to use the register.', confirmText: 'Sign out' })) {
      await signOut();
      toast('Signed out. See you soon!');
    }
  };

  return (
    <div className="shell">
      <button className="icon-btn mobile-menu" onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className={`sidebar-scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <LogoMark size={42} />
          <div>
            <div className="brand-name display">
              {BRAND.first}
              <em>{BRAND.second}</em>
            </div>
            <div className="eyebrow">Point of sale</div>
          </div>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="nav">
          <span className="eyebrow nav-label">Workspace</span>
          {links
            .filter((l) => l.show)
            .map(({ to, label, icon: Icon, end, badge }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Icon size={18} strokeWidth={1.6} />
                <span>{label}</span>
                {!!badge && <em className="badge pulse">{badge > 99 ? '99+' : badge}</em>}
              </NavLink>
            ))}
        </nav>

        <div className="sidebar-foot">
          <div className="me">
            <span className="avatar">{initials(profile?.full_name ?? '')}</span>
            <div className="me-text">
              <strong>{profile?.full_name}</strong>
              <span className="me-role">
                {isAdmin ? (
                  'Store owner'
                ) : canManageProducts ? (
                  <>
                    <ShieldCheck size={12} /> Authorized staff
                  </>
                ) : (
                  'Staff'
                )}
              </span>
            </div>
          </div>
          <button className="icon-btn" onClick={handleSignOut} title="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="main">
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>

      {isAdmin && <NotificationCards />}
    </div>
  );
}
