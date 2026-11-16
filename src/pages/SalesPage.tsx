import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ReceiptText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { fmtDate, fmtMoney } from '../lib/format';
import type { Sale } from '../lib/types';

type Range = 'today' | '7d' | '30d' | 'all';

export default function SalesPage() {
  const { isAdmin } = useAuth();
  const [range, setRange] = useState<Range>('today');
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    let q = supabase
      .from('sales')
      .select('*, cashier:profiles(full_name), sale_items(*)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (range !== 'all') {
      const d = new Date();
      if (range === 'today') d.setHours(0, 0, 0, 0);
      else d.setDate(d.getDate() - (range === '7d' ? 7 : 30));
      q = q.gte('created_at', d.toISOString());
    }
    q.then(({ data }) => {
      setSales((data as Sale[]) ?? []);
      setLoading(false);
    });
  }, [range]);

  const totals = useMemo(
    () => ({
      revenue: sales.reduce((a, s) => a + Number(s.total), 0),
      discount: sales.reduce((a, s) => a + Number(s.discount), 0),
      avg: sales.length ? sales.reduce((a, s) => a + Number(s.total), 0) / sales.length : 0,
    }),
    [sales],
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{isAdmin ? 'All registers' : 'Your register'}</span>
          <h1 className="display">Sales</h1>
        </div>
        <div className="tabs no-margin">
          {(['today', '7d', '30d', 'all'] as Range[]).map((r) => (
            <button key={r} className={`tab ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>
              {{ today: 'Today', '7d': '7 days', '30d': '30 days', all: 'All' }[r]}
            </button>
          ))}
        </div>
      </header>

      <div className="stats three">
        <div className="stat accent">
          <span className="eyebrow">Revenue</span>
          <b className="display stat-value">{fmtMoney(totals.revenue)}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Transactions</span>
          <b className="display stat-value">{sales.length}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Average sale</span>
          <b className="display stat-value">{fmtMoney(totals.avg)}</b>
        </div>
      </div>

      {loading ? (
        <div className="table-skeleton">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : sales.length === 0 ? (
        <div className="empty">
          <ReceiptText size={36} strokeWidth={1.2} />
          <p>No sales in this period.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>When</th>
                {isAdmin && <th>Cashier</th>}
                <th>Payment</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <Fragment key={s.id}>
                  <tr className="clickable" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <td className="mono small">{s.receipt_no}</td>
                    <td className="small">{fmtDate(s.created_at)}</td>
                    {isAdmin && <td>{s.cashier?.full_name ?? '—'}</td>}
                    <td>
                      <span className="tag">{s.payment_method}</span>
                    </td>
                    <td className="num">
                      <b>{fmtMoney(s.total)}</b>
                    </td>
                    <td className="actions">
                      <ChevronDown size={16} className={`chev ${open === s.id ? 'up' : ''}`} />
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr className="detail-row">
                      <td colSpan={isAdmin ? 6 : 5}>
                        <div className="receipt-lines reveal">
                          {s.sale_items?.map((i) => (
                            <div key={i.id}>
                              <span>
                                {i.quantity} × {i.name} <span className="muted">@ {fmtMoney(i.unit_price)}</span>
                              </span>
                              <span>{fmtMoney(i.line_total)}</span>
                            </div>
                          ))}
                          {Number(s.discount) > 0 && (
                            <div className="muted">
                              <span>Discount</span>
                              <span>−{fmtMoney(s.discount)}</span>
                            </div>
                          )}
                          <div className="muted">
                            <span>Paid / change</span>
                            <span>
                              {fmtMoney(s.amount_paid)} / {fmtMoney(s.change_due)}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
