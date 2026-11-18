import { useMemo, useState, type ReactNode } from 'react';
import { Boxes, Carrot, ChefHat, Layers, Lock, PackagePlus, Pencil, QrCode, Search, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useProducts } from '../hooks/useProducts';
import { useRecipes } from '../hooks/useRecipes';
import { canMakeOf, isMade, kindOf } from '../lib/recipes';
import ProductForm from '../components/ProductForm';
import StockAdjust from '../components/StockAdjust';
import Modal from '../components/Modal';
import CodeLabel from '../components/CodeLabel';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { fmtMoney } from '../lib/format';
import type { Product, ProductKind } from '../lib/types';

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
  const [kindF, setKindF] = useState<'all' | ProductKind>('all');
  const { data: recipes, byMenu, byCombo } = useRecipes();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // menu items have no stock of their own: use how many can be made right now
  const avail = (p: Product) => (isMade(p) ? canMakeOf(p, recipes, byId) ?? 0 : p.stock);
  const hasFood = products.some((p) => kindOf(p) !== 'item');
  const kindCount = (k: ProductKind) => products.filter((p) => p.is_active && kindOf(p) === k).length;

  const counts = useMemo(
    () => ({
      all: products.filter((p) => p.is_active).length,
      low: products.filter((p) => p.is_active && avail(p) > 0 && avail(p) <= p.low_stock_threshold).length,
      out: products.filter((p) => p.is_active && avail(p) <= 0).length,
      custom: products.filter((p) => p.is_custom).length,
      inactive: products.filter((p) => !p.is_active).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, recipes],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === 'inactive' ? p.is_active : !p.is_active) return false;
      if (kindF !== 'all' && kindOf(p) !== kindF) return false;
      if (filter === 'low' && !(avail(p) > 0 && avail(p) <= p.low_stock_threshold)) return false;
      if (filter === 'out' && avail(p) > 0) return false;
      if (filter === 'custom' && !p.is_custom) return false;
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      return [p.name, p.barcode, p.word_code, p.category].some((v) => v?.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, filter, cat, kindF, recipes]);

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

  const stockState = (p: Product) => (avail(p) <= 0 ? 'out' : avail(p) <= p.low_stock_threshold ? 'low' : 'ok');

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

      {hasFood && (
        <div className="chips">
          {(
            [
              ['all', 'Everything', null],
              ['item', 'Items', null],
              ['menu', 'Menu', <ChefHat key="m" size={13} />],
              ['combo', 'Combos', <Layers key="c" size={13} />],
              ['ingredient', 'Ingredients', <Carrot key="i" size={13} />],
            ] as ['all' | ProductKind, string, ReactNode][]
          ).map(([k, label, icon]) => (
            <button key={k} className={`chip-btn ${kindF === k ? 'on' : ''}`} onClick={() => setKindF(k)}>
              {icon} {label}
              {k !== 'all' && <small> {kindCount(k)}</small>}
            </button>
          ))}
        </div>
      )}

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
                          {kindOf(p) === 'menu' && (
                            <span className="tag tag-menu">
                              <ChefHat size={10} /> menu
                            </span>
                          )}
                          {kindOf(p) === 'combo' && (
                            <span className="tag tag-menu">
                              <Layers size={10} /> combo
                            </span>
                          )}
                          {kindOf(p) === 'ingredient' && (
                            <span className="tag tag-ing">
                              <Carrot size={10} /> ingredient
                            </span>
                          )}
                          {p.is_custom && kindOf(p) === 'item' && (
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
                  <td className="num">{kindOf(p) === 'ingredient' ? <span className="muted small">{fmtMoney(p.cost)}/{p.unit}</span> : fmtMoney(p.price)}</td>
                  <td className="num">
                    {isMade(p) ? (
                      <span className={`stock stock-${stockState(p)}`} title="How many can be made from the ingredients in stock">
                        {(kindOf(p) === 'menu' ? byMenu.get(p.id)?.length : byCombo.get(p.id)?.length) ? (
                          <>
                            can make {avail(p)}
                          </>
                        ) : (
                          kindOf(p) === 'menu' ? 'no recipe' : 'empty combo'
                        )}
                      </span>
                    ) : (
                      <span className={`stock stock-${stockState(p)}`}>
                        {p.stock} <small>{p.unit}</small>
                      </span>
                    )}
                  </td>
                  <td className="actions">
                    <button className="icon-btn" title="Codes & label" onClick={() => setLabelFor(p)}>
                      <QrCode size={16} />
                    </button>
                    {canManageProducts && (
                      <>
                        {!isMade(p) && (
                          <button className="icon-btn" title="Adjust stock" onClick={() => setAdjusting(p)}>
                            <Boxes size={16} />
                          </button>
                        )}
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
