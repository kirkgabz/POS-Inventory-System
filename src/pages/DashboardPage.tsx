import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Package, Receipt, ScanLine, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useProducts } from '../hooks/useProducts';
import { supabase } from '../lib/supabase';
import { fmtMoney, timeAgo } from '../lib/format';
import type { Sale } from '../lib/types';

export default function DashboardPage() {
  const { profile, isAdmin } = useAuth();
  const { products } = useProducts();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);
    supabase
      .from('sales')
      .select('*, cashier:profiles(full_name), sale_items(quantity)')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSales((data as Sale[]) ?? []);
        setLoading(false);
      });
  }, []);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todays = sales.filter((s) => new Date(s.created_at).toDateString() === today);
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toDateString();
      return {
        label: d.toLocaleDateString(undefined, { weekday: 'short' }),
        total: sales.filter((s) => new Date(s.created_at).toDateString() === key).reduce((a, s) => a + Number(s.total), 0),
        isToday: key === today,
      };
    });
    return {
      revenue: todays.reduce((a, s) => a + Number(s.total), 0),
      count: todays.length,
      items: todays.reduce((a, s) => a + (s.sale_items ?? []).reduce((b, i) => b + i.quantity, 0), 0),
      week: days.reduce((a, d) => a + d.total, 0),
      days,
      max: Math.max(1, ...days.map((d) => d.total)),
    };
  }, [sales]);

  const low = useMemo(
    () => products.filter((p) => p.stock <= p.low_stock_threshold).sort((a, b) => a.stock - b.stock).slice(0, 6),
    [products],
  );

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <h1 className="display">
            {greet}, <em>{profile?.full_name?.split(' ')[0]}</em>.
          </h1>
        </div>
        <Link to="/pos" className="btn btn-primary">
          <ScanLine size={16} /> Open register
        </Link>
      </header>

      <div className="stats">
        <Stat label={isAdmin ? "Today's revenue" : 'Your sales today'} value={fmtMoney(stats.revenue)} icon={<TrendingUp size={18} />} accent loading={loading} />
        <Stat label="Transactions" value={String(stats.count)} icon={<Receipt size={18} />} loading={loading} />
        <Stat label="Items sold" value={String(stats.items)} icon={<Package size={18} />} loading={loading} />
        <Stat label="Low / out of stock" value={String(products.filter((p) => p.stock <= p.low_stock_threshold).length)} icon={<AlertTriangle size={18} />} warn />
      </div>

      <div className="dash-grid">
        <section className="card">
          <header className="card-head">
            <div>
              <span className="eyebrow">Last 7 days</span>
              <h3 className="display">{fmtMoney(stats.week)}</h3>
            </div>
          </header>
          <div className="bars">
            {stats.days.map((d, i) => (
              <div key={i} className={`bar ${d.isToday ? 'today' : ''}`} title={fmtMoney(d.total)}>
                <i style={{ height: `${Math.max(3, (d.total / stats.max) * 100)}%`, animationDelay: `${i * 60}ms` }} />
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <header className="card-head">
            <div>
              <span className="eyebrow">Needs attention</span>
              <h3 className="display">Low stock</h3>
            </div>
            <Link to="/products" className="link">
              Inventory <ArrowUpRight size={14} />
            </Link>
          </header>
          {low.length === 0 ? (
            <p className="muted">Everything is well stocked. ✦</p>
          ) : (
            <ul className="list">
              {low.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span className={`stock stock-${p.stock <= 0 ? 'out' : 'low'}`}>{p.stock} {p.unit}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card span-2">
          <header className="card-head">
            <div>
              <span className="eyebrow">Latest</span>
              <h3 className="display">Recent sales</h3>
            </div>
            <Link to="/sales" className="link">
              All sales <ArrowUpRight size={14} />
            </Link>
          </header>
          {sales.length === 0 ? (
            <p className="muted">No sales yet this week.</p>
          ) : (
            <ul className="list">
              {sales.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <span>
                    <span className="mono small">{s.receipt_no}</span>
                    <span className="muted small"> · {s.cashier?.full_name ?? '—'} · {timeAgo(s.created_at)}</span>
                  </span>
                  <b>{fmtMoney(s.total)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, accent, warn, loading }: { label: string; value: string; icon: ReactNode; accent?: boolean; warn?: boolean; loading?: boolean }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''} ${warn ? 'warn' : ''}`}>
      <div className="stat-top">
        <span className="eyebrow">{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{value}</b>}
    </div>
  );
}
