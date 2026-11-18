import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarDays,
  FileSpreadsheet,
  History,
  Loader2,
  PackagePlus,
  PencilLine,
  Tag,
  Trash2,
  UserRound,
} from 'lucide-react';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { fmtMoney, initials, roleName } from '../lib/format';
import type { ActivityAction, ProductActivity } from '../lib/types';

type Range = 'today' | 'week' | 'month' | 'custom';
type Filter = 'all' | 'added' | 'price' | 'edited' | 'in' | 'out' | 'waste';

const FILTERS: { key: Filter; label: string; actions: ActivityAction[] }[] = [
  { key: 'all', label: 'All', actions: [] },
  { key: 'added', label: 'Products added', actions: ['added'] },
  { key: 'in', label: 'Stock added', actions: ['restock', 'stock_in'] },
  { key: 'price', label: 'Price changes', actions: ['price'] },
  { key: 'edited', label: 'Edits', actions: ['edited', 'deleted'] },
  { key: 'out', label: 'Stock removed', actions: ['stock_out'] },
  { key: 'waste', label: 'Spoilage / waste', actions: ['waste'] },
];

const ACTION: Record<ActivityAction, { label: string; tone: string; icon: typeof History }> = {
  added: { label: 'Added product', tone: 'sage', icon: PackagePlus },
  restock: { label: 'Restocked', tone: 'sage', icon: ArrowUpCircle },
  stock_in: { label: 'Stock added', tone: 'sage', icon: ArrowUpCircle },
  stock_out: { label: 'Stock removed', tone: 'danger', icon: ArrowDownCircle },
  waste: { label: 'Waste', tone: 'danger', icon: Trash2 },
  price: { label: 'Price change', tone: 'accent', icon: Tag },
  edited: { label: 'Edited', tone: 'ochre', icon: PencilLine },
  deleted: { label: 'Deleted', tone: 'danger', icon: Trash2 },
};

const FIELD: Record<string, string> = {
  name: 'Name',
  price: 'Price',
  cost: 'Cost',
  category: 'Category',
  unit: 'Unit',
  pack_size: 'Pack size',
  barcode: 'Barcode',
  word_code: 'Word code',
  low_stock: 'Low-stock alert',
  active: 'Visible at register',
  photo: 'Photo',
  notes: 'Notes',
};
const MONEY = new Set(['price', 'cost']);

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (s: string) => new Date(`${s}T00:00:00`);

function rangeDates(range: Range, from: string, to: string): { start: Date; end: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  if (range === 'today') return { start: today, end: tomorrow };
  if (range === 'week') return { start: new Date(today.getTime() - 6 * 86400000), end: tomorrow };
  if (range === 'month') return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: tomorrow };
  const a = startOfDay(from || ymd(today));
  const b = startOfDay(to || ymd(today));
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { start: lo, end: new Date(hi.getTime() + 86400000) };
}

const val = (field: string, v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (MONEY.has(field)) return fmtMoney(Number(v));
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

/** Plain-language description of one activity row. */
export function describe(a: ProductActivity): string[] {
  const c = a.changes ?? {};
  if (a.action === 'added') {
    const parts = [`Price ${fmtMoney(Number(c.price ?? 0))}`];
    if (Number(c.cost) > 0) parts.push(`cost ${fmtMoney(Number(c.cost))}`);
    if (Number(c.stock) > 0) parts.push(`starting stock ${c.stock} ${c.unit ?? ''}`.trim());
    if (Number(c.pack_size) > 1) parts.push(`packs of ${c.pack_size}`);
    return [parts.join(' · ')];
  }
  if (a.action === 'restock' || a.action === 'stock_in' || a.action === 'stock_out' || a.action === 'waste') {
    const n = a.stock_change ?? 0;
    return [`${n > 0 ? '+' : '−'}${Math.abs(n)} in stock${a.note ? ` · ${a.note}` : ''}`];
  }
  if (a.action === 'deleted') return [`Removed from inventory${c.stock !== undefined ? ` (had ${c.stock} in stock)` : ''}`];
  return Object.entries(c).map(([k, pair]) => {
    const [o, n] = Array.isArray(pair) ? pair : [undefined, pair];
    if (k === 'photo') return n ? 'Photo updated' : 'Photo removed';
    return `${FIELD[k] ?? k}: ${val(k, o)} → ${val(k, n)}`;
  });
}

async function fetchActivity(start: Date, end: Date, actor: string, actions: ActivityAction[]) {
  const all: ProductActivity[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('product_activity')
      .select('*')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (actor !== 'all') q = q.eq('actor_id', actor);
    if (actions.length) q = q.in('action', actions);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...((data as ProductActivity[]) ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export default function ActivityPage() {
  const [people, setPeople] = useState<{ id: string; full_name: string; role: string }[]>([]);
  const [actor, setActor] = useState('all');
  const [range, setRange] = useState<Range>('week');
  const [from, setFrom] = useState(ymd(new Date()));
  const [to, setTo] = useState(ymd(new Date()));
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<ProductActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);

  const { start, end } = useMemo(() => rangeDates(range, from, to), [range, from, to]);
  const actions = FILTERS.find((f) => f.key === filter)!.actions;

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .order('full_name')
      .then(({ data }) => setPeople((data as typeof people) ?? []));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchActivity(start, end, actor, actions)
      .then((d) => alive && setRows(d))
      .catch((e) => {
        if (!alive) return;
        const msg = errorMessage(e);
        failure('Could not load the inventory log', /product_activity/.test(msg) ? 'Run migration 010_inventory_activity.sql in Supabase first.' : msg);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, actor, filter, tick]);

  // live: new activity appears without refreshing
  useEffect(() => {
    const ch = supabase
      .channel('product-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'product_activity' }, () => setTick((t) => t + 1))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const stats = useMemo(() => {
    let added = 0, prices = 0, unitsIn = 0, unitsOut = 0;
    rows.forEach((r) => {
      if (r.action === 'added') {
        added++;
        unitsIn += Math.max(0, r.stock_change ?? 0);
      } else if (r.action === 'price') prices++;
      else if (r.action === 'restock' || r.action === 'stock_in') unitsIn += r.stock_change ?? 0;
      else if (r.action === 'stock_out' || r.action === 'waste') unitsOut += Math.abs(r.stock_change ?? 0);
    });
    return { added, prices, unitsIn, unitsOut };
  }, [rows]);

  // group by calendar day
  const days = useMemo(() => {
    const m = new Map<string, ProductActivity[]>();
    rows.forEach((r) => {
      const k = ymd(new Date(r.created_at));
      m.set(k, [...(m.get(k) ?? []), r]);
    });
    return [...m.entries()];
  }, [rows]);

  const personName = actor === 'all' ? 'Everyone' : people.find((p) => p.id === actor)?.full_name ?? '';
  const rangeLabel =
    range === 'today'
      ? 'Today'
      : range === 'week'
        ? 'Last 7 days'
        : range === 'month'
          ? 'This month'
          : `${start.toLocaleDateString()} – ${new Date(end.getTime() - 1).toLocaleDateString()}`;

  const exportExcel = async () => {
    const ok = await confirmAction({
      title: 'Download inventory log?',
      html: `<b>${rangeLabel}</b> · ${personName}<br/>${rows.length} record(s)`,
      confirmText: 'Download',
      icon: 'question',
    });
    if (!ok) return;
    setExporting(true);
    try {
      const { downloadActivityExcel } = await import('../lib/activityReport');
      await downloadActivityExcel(rows, `${rangeLabel} · ${personName}`, describe);
      success('Log downloaded', 'Check your Downloads folder.');
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
          <span className="eyebrow">Who changed what, and when</span>
          <h1 className="display">Inventory log</h1>
        </div>
        <button className="btn btn-primary" onClick={exportExcel} disabled={loading || exporting || rows.length === 0}>
          {exporting ? <Loader2 size={16} className="spin" /> : <FileSpreadsheet size={16} />}
          Download Excel
        </button>
      </header>

      <div className="log-filters">
        <label className="who-filter">
          <UserRound size={15} />
          <select className="input" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Person">
            <option value="all">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} · {roleName(p.role)}
              </option>
            ))}
          </select>
        </label>
        <div className="tabs no-margin">
          {(['today', 'week', 'month', 'custom'] as Range[]).map((r) => (
            <button key={r} className={`tab ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>
              {{ today: 'Today', week: '7 days', month: 'This month', custom: 'Pick dates' }[r]}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="date-range reveal">
            <CalendarDays size={15} />
            <input className="input" type="date" value={from} max={ymd(new Date())} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span className="muted">to</span>
            <input className="input" type="date" value={to} max={ymd(new Date())} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
        )}
      </div>

      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip-btn ${filter === f.key ? 'on' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="stats">
        <div className="stat accent">
          <span className="eyebrow">Products added</span>
          {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{stats.added}</b>}
        </div>
        <div className="stat">
          <span className="eyebrow">Units stocked in</span>
          {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">+{stats.unitsIn}</b>}
        </div>
        <div className="stat">
          <span className="eyebrow">Price changes</span>
          {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{stats.prices}</b>}
        </div>
        <div className="stat">
          <span className="eyebrow">Units removed</span>
          {loading ? <div className="skeleton sk-line" /> : <b className="display stat-value">{stats.unitsOut ? `−${stats.unitsOut}` : 0}</b>}
        </div>
      </div>

      {loading ? (
        <div className="table-skeleton">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <History size={36} strokeWidth={1.2} />
          <p>
            No inventory activity {actor !== 'all' ? `by ${personName} ` : ''}for {rangeLabel.toLowerCase()}.
          </p>
        </div>
      ) : (
        <div className="log">
          {days.map(([day, list]) => (
            <section key={day} className="log-day">
              <h3 className="eyebrow">
                {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                <span className="muted"> · {list.length}</span>
              </h3>
              <ul>
                {list.map((a) => {
                  const meta = ACTION[a.action];
                  const Icon = meta.icon;
                  return (
                    <li key={a.id} className={`log-row tone-${meta.tone}`}>
                      <span className="log-icon">
                        <Icon size={16} />
                      </span>
                      <div className="log-body">
                        <div className="log-top">
                          <b>{a.product_name}</b>
                          <span className="log-tag">{meta.label}</span>
                        </div>
                        {describe(a).map((line, i) => (
                          <div key={i} className="log-detail">
                            {line}
                          </div>
                        ))}
                      </div>
                      <div className="log-who">
                        <span className={`avatar sm ${a.actor_role === 'admin' ? 'admin' : ''}`}>{initials(a.actor_name)}</span>
                        <div>
                          <b>{a.actor_name}</b>
                          <small className="muted">
                            {roleName(a.actor_role) || '—'} · {new Date(a.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          </small>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
