import { useMemo, useState } from 'react';
import { Boxes, Lock, PackagePlus, Pencil, QrCode, Search, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useProducts } from '../hooks/useProducts';
import ProductForm from '../components/ProductForm';
import StockAdjust from '../components/StockAdjust';
import Modal from '../components/Modal';
import CodeLabel from '../components/CodeLabel';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { fmtMoney } from '../lib/format';
import type { Product } from '../lib/types';

type Filter = 'all' | 'low' | 'out' | 'custom' | 'inactive';

export default function ProductsPage() {
  const { isAdmin, canManageProducts } = useAuth();
  const { products, loading, categories, upsertLocal, setProducts } = useProducts(isAdmin);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [cat, setCat] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [labelFor, setLabelFor] = useState<Product | null>(null);

  const counts = useMemo(
    () => ({
      all: products.filter((p) => p.is_active).length,
      low: products.filter((p) => p.is_active && p.stock > 0 && p.stock <= p.low_stock_threshold).length,
      out: products.filter((p) => p.is_active && p.stock <= 0).length,
      custom: products.filter((p) => p.is_custom).length,
      inactive: products.filter((p) => !p.is_active).length,
    }),
    [products],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === 'inactive' ? p.is_active : !p.is_active) return false;
      if (filter === 'low' && !(p.stock > 0 && p.stock <= p.low_stock_threshold)) return false;
      if (filter === 'out' && p.stock > 0) return false;
      if (filter === 'custom' && !p.is_custom) return false;
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      return [p.name, p.barcode, p.word_code, p.category].some((v) => v?.toLowerCase().includes(q));
    });
  }, [products, query, filter, cat]);

  const remove = async (p: Product) => {
    const ok = await confirmAction({
      title: 'Delete this product?',
      html: `<b>${p.name}</b> will be removed permanently.<br/><small>Past sales keep their records. To just hide it, edit and untick “Active”.</small>`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('products').delete().eq('id', p.id);
    if (error) return failure('Could not delete', errorMessage(error));
    setProducts((l) => l.filter((x) => x.id !== p.id));
    success('Deleted', p.name);
  };

  const stockState = (p: Product) => (p.stock <= 0 ? 'out' : p.stock <= p.low_stock_threshold ? 'low' : 'ok');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Inventory</span>
          <h1 className="display">Products</h1>
        </div>
        {canManageProducts ? (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <PackagePlus size={16} /> Add product
          </button>
        ) : (
          <span className="chip">
            <Lock size={13} /> View only — ask the store owner for product access
          </span>
        )}
      </header>

      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input className="input" placeholder="Search name, barcode or word code…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="input select-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="tabs">
        {(
          [
            ['all', 'All'],
            ['low', 'Low stock'],
            ['out', 'Out of stock'],
            ['custom', 'Own products'],
            ...(isAdmin ? [['inactive', 'Hidden']] : []),
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            {label} <em>{counts[k]}</em>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="table-skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <Boxes size={36} strokeWidth={1.2} />
          <p>No products here yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Code</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => (
                <tr key={p.id} className="row-in" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
                  <td>
                    <div className="prod-cell">
                      <span className={`prod-dot ${p.image_url ? 'has-img' : ''}`} data-letter={p.name[0]}>
                        {p.image_url && <img src={p.image_url} alt="" loading="lazy" />}
                      </span>
                      <div>
                        <strong>{p.name}</strong>
                        <div className="muted small">
                          {p.category || 'Uncategorised'}
                          {p.is_custom && (
                            <span className="tag">
                              <Sparkles size={10} /> own
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono small">
                    {p.word_code && <div>{p.word_code}</div>}
                    {p.barcode && <div className="muted">{p.barcode}</div>}
                  </td>
                  <td className="num">{fmtMoney(p.price)}</td>
                  <td className="num">
                    <span className={`stock stock-${stockState(p)}`}>
                      {p.stock} <small>{p.unit}</small>
                    </span>
                  </td>
                  <td className="actions">
                    <button className="icon-btn" title="Codes & label" onClick={() => setLabelFor(p)}>
                      <QrCode size={16} />
                    </button>
                    {canManageProducts && (
                      <>
                        <button className="icon-btn" title="Adjust stock" onClick={() => setAdjusting(p)}>
                          <Boxes size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => {
                            setEditing(p);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                      </>
                    )}
                    {isAdmin && (
                      <button className="icon-btn danger" title="Delete" onClick={() => remove(p)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProductForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        product={editing}
        categories={categories}
        onSaved={upsertLocal}
        onExisting={(p) => {
          setEditing(p);
          setTimeout(() => setFormOpen(true), 50);
        }}
      />

      <StockAdjust
        product={adjusting}
        onClose={() => setAdjusting(null)}
        onSaved={(id, stock) => setProducts((l) => l.map((p) => (p.id === id ? { ...p, stock } : p)))}
      />

      <Modal open={!!labelFor} onClose={() => setLabelFor(null)} title="Codes & label" subtitle={labelFor?.name}>
        {labelFor && (
          <div className="label-modal">
            <div className="preview-price">{fmtMoney(labelFor.price)}</div>
            <CodeLabel name={labelFor.name} price={labelFor.price} barcode={labelFor.barcode} wordCode={labelFor.word_code} />
          </div>
        )}
      </Modal>
    </div>
  );
}
