import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Printer, ReceiptText, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { fmtDate, fmtMoney, methodLabel, roleName, takenBy } from '../lib/format';
import { getPeriod, type PeriodType } from '../lib/period';
import { summarise } from '../lib/salesReport';
import { printReceipt } from '../lib/receipt';
import type { Sale } from '../lib/types';

const PAGE = 1000;

async function fetchSales(start: Date, end: Date): Promise<Sale[]> {
  const all: Sale[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sales')
      .select('*, cashier:profiles(full_name, role), sale_items(*)')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data as Sale[]) ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export default function SalesPage() {
  const { isAdmin, profile } = useAuth();
  const [type, setType] = useState<PeriodType>('day');
  const [offset, setOffset] = useState(0);
  const [allSales, setSales] = useState<Sale[]>([]);
  const [who, setWho] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const period = useMemo(() => getPeriod(type, offset), [type, offset]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchSales(period.start, period.end)
      .then((d) => {
        if (alive) setSales(d);
      })
      .catch((e) => {
        if (alive) failure('Could not load sales', errorMessage(e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period]);

  // everyone who took an order in this period (owner filter)
  const takers = useMemo(() => {
    const m = new Map<string, { key: string; name: string; role: string | null | undefined; count: number }>();
    allSales.forEach((x) => {
      const key = x.cashier_id ?? `name:${takenBy(x)}`;
      const g = m.get(key) ?? { key, name: takenBy(x), role: x.cashier_role ?? x.cashier?.role, count: 0 };
      g.count++;
      m.set(key, g);
    });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allSales]);
  const sales = useMemo(
    () => (who === 'all' ? allSales : allSales.filter((x) => (x.cashier_id ?? `name:${takenBy(x)}`) === who)),
    [allSales, who],
  );
  const whoLabel = who === 'all' ? '' : takers.find((t) => t.key === who)?.name ?? '';

  const s = useMemo(() => summarise(sales, period), [sales, period]);
  const maxBar = Math.max(1, ...s.breakdown.map((b) => b.revenue));

  const reprint = async (sale: Sale) => {
    const ok = await confirmAction({
      title: 'Reprint this receipt?',
      html: `<span class="mono">${sale.receipt_no}</span> · ${fmtMoney(sale.total)}<br/><small>It will be marked as a REPRINT.</small>`,
      confirmText: 'Print',
    });
    if (!ok) return;
    const opened = await printReceipt({
      receipt_no: sale.receipt_no,
      at: sale.created_at,
      cashier: takenBy(sale),
      lines: (sale.sale_items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unit_price: Number(i.unit_price) })),
      subtotal: Number(sale.subtotal),
      discount: Number(sale.discount),
      total: Number(sale.total),
      method: sale.payment_method,
      amount_paid: Number(sale.amount_paid),
      change: Number(sale.change_due),
      account: sale.payment_account,
      ref: sale.payment_ref,
      reprint: true,
    });
    if (!opened) failure('Pop-up blocked', 'Allow pop-ups for this site to print receipts.');
  };

  const exportExcel = async () => {
    const ok = await confirmAction({
      title: 'Download Excel report?',
      html: `<b>${period.label}</b>${whoLabel ? ` · ${whoLabel}` : ''}<br/>${s.transactions} transaction(s) · ${fmtMoney(s.revenue)}<br/><small class="muted">Includes summary, ${type === 'day' ? 'hourly' : type === 'year' ? 'monthly' : 'daily'} breakdown, every transaction and items sold.</small>`,
      confirmText: 'Download',
      icon: 'question',
    });
    if (!ok) return;
    setExporting(true);
    try {
      const { downloadSalesExcel } = await import('../lib/salesReport');
      await downloadSalesExcel(sales, whoLabel ? { ...period, label: `${period.label} · ${whoLabel}` } : period, profile?.full_name ?? 'Store owner');
      success('Report downloaded', 'Check your Downloads folder.');
    } catch (e) {
      failure('Could not create the file', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{isAdmin ? 'All registers' : 'Your register'}</span>
          <h1 className="display">Sales</h1>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={exportExcel} disabled={loading || exporting}>
            {exporting ? <Loader2 size={16} className="spin" /> : <FileSpreadsheet size={16} />}
            Download Excel
          </button>
        )}
      </header>

      <div className="period-bar">
        <div className="tabs no-margin">
          {(['day', 'week', 'month', 'year'] as PeriodType[]).map((t) => (
            <button
              key={t}
              className={`tab ${type === t ? 'on' : ''}`}
              onClick={() => {
                setType(t);
                setOffset(0);
              }}
            >
              {{ day: 'Day', week: 'Week', month: 'Month', year: 'Year' }[t]}
            </button>
          ))}
        </div>
        <div className="period-nav">
          <button className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous">
            <ChevronLeft size={18} />
          </button>
          <strong className="display period-label" key={period.label}>
            {period.label}
          </strong>
          <button className="icon-btn" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} aria-label="Next">
            <ChevronRight size={18} />
          </button>
          {offset !== 0 && (
            <button className="btn btn-ghost btn-xs" onClick={() => setOffset(0)}>
              {{ day: 'Today', week: 'This week', month: 'This month', year: 'This year' }[type]}
            </button>
          )}
        </div>
        {isAdmin && takers.length > 0 && (
          <label className="who-filter">
            <UserRound size={15} />
            <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Taken by">
              <option value="all">Everyone ({allSales.length})</option>
              {takers.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                  {roleName(t.role) ? ` · ${roleName(t.role)}` : ''} ({t.count})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className={`stats ${isAdmin ? '' : 'three'}`}>
        <div className="stat accent">
          <span className="eyebrow">Revenue</span>
          {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{fmtMoney(s.revenue)}</b>}
        </div>
        <div className="stat">
          <span className="eyebrow">Transactions · items</span>
          {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{s.transactions} <small className="muted">· {s.items}</small></b>}
        </div>
        <div className="stat">
          <span className="eyebrow">Average sale</span>
          {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{fmtMoney(s.average)}</b>}
        </div>
        {isAdmin && (
          <div className="stat">
            <span className="eyebrow">Gross profit</span>
            {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{fmtMoney(s.profit)}</b>}
          </div>
        )}
      </div>

      {!loading && s.transactions > 0 && (
        <section className="card">
          <header className="card-head">
            <div>
              <span className="eyebrow">{type === 'day' ? 'By hour' : type === 'year' ? 'By month' : 'By day'}</span>
              <h3 className="display">Breakdown</h3>
            </div>
          </header>
          <div className={`bars bars-${type}`}>
            {s.breakdown.map((b, i) => (
              <div key={i} className="bar" title={`${b.label}: ${fmtMoney(b.revenue)} · ${b.count} sale(s)`}>
                <i style={{ height: `${Math.max(2, (b.revenue / maxBar) * 100)}%`, animationDelay: `${i * 20}ms` }} />
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
                <th>Taken by</th>
                <th>Payment</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <Fragment key={sale.id}>
                  <tr className="clickable" onClick={() => setOpen(open === sale.id ? null : sale.id)}>
                    <td className="mono small">{sale.receipt_no}</td>
                    <td className="small">{fmtDate(sale.created_at)}</td>
                    <td>
                      <span className="taker">
                        {takenBy(sale)}
                        {(sale.cashier_role ?? sale.cashier?.role) === 'admin' && <span className="tag tag-owner">Store owner</span>}
                      </span>
                    </td>
                    <td>
                      <span className="tag">{methodLabel(sale.payment_method)}</span>
                    </td>
                    <td className="num">
                      <b>{fmtMoney(sale.total)}</b>
                    </td>
                    <td className="actions">
                      <ChevronDown size={16} className={`chev ${open === sale.id ? 'up' : ''}`} />
                    </td>
                  </tr>
                  {open === sale.id && (
                    <tr className="detail-row">
                      <td colSpan={6}>
                        <div className="receipt-lines reveal">
                          {sale.sale_items?.map((i) => (
                            <div key={i.id}>
                              <span>
                                {i.quantity} × {i.name} <span className="muted">@ {fmtMoney(i.unit_price)}</span>
                              </span>
                              <span>{fmtMoney(i.line_total)}</span>
                            </div>
                          ))}
                          {Number(sale.discount) > 0 && (
                            <div className="muted">
                              <span>Discount</span>
                              <span>−{fmtMoney(sale.discount)}</span>
                            </div>
                          )}
                          <div className="muted">
                            <span>{sale.payment_account ? `${sale.payment_account}${sale.payment_ref ? ` · Ref ${sale.payment_ref}` : ''}` : 'Paid / change'}</span>
                            <span>
                              {fmtMoney(sale.amount_paid)} / {fmtMoney(sale.change_due)}
                            </span>
                          </div>
                          <div className="muted">
                            <span>Taken by</span>
                            <span>
                              {takenBy(sale)}
                              {roleName(sale.cashier_role ?? sale.cashier?.role) ? ` · ${roleName(sale.cashier_role ?? sale.cashier?.role)}` : ''}
                            </span>
                          </div>
                          <div className="receipt-actions">
                            <button className="btn btn-ghost btn-xs" onClick={() => reprint(sale)}>
                              <Printer size={13} /> Reprint receipt
                            </button>
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
