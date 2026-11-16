import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Barcode, Camera, Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import Modal from './Modal';
import CameraScanner, { beep } from './CameraScanner';
import CodeLabel from './CodeLabel';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { generateEan13, generateWordCode, normaliseCode } from '../lib/codes';
import { fmtMoney } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import type { Product, ProductInput } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
  /** Pre-fill barcode (e.g. scanned at POS but not found) */
  initialCode?: string;
  categories: string[];
  onSaved: (p: Product) => void;
}

const empty: ProductInput = {
  name: '',
  description: '',
  category: '',
  barcode: '',
  word_code: '',
  is_custom: false,
  price: 0,
  cost: 0,
  stock: 0,
  low_stock_threshold: 5,
  unit: 'pc',
  is_active: true,
};

export default function ProductForm({ open, onClose, product, initialCode, categories, onSaved }: Props) {
  const { isAdmin } = useAuth();
  const editing = !!product;
  const [form, setForm] = useState<ProductInput>(empty);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScanning(false);
    if (product) {
      const { id: _i, created_by: _c, updated_by: _u, created_at: _ca, updated_at: _ua, ...rest } = product;
      setForm({ ...rest, description: rest.description ?? '', category: rest.category ?? '', barcode: rest.barcode ?? '', word_code: rest.word_code ?? '' });
    } else {
      setForm({ ...empty, barcode: initialCode ?? '' });
    }
  }, [open, product, initialCode]);

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Store-owned items: generate codes automatically
  const makeCustom = (custom: boolean) => {
    setForm((f) => ({
      ...f,
      is_custom: custom,
      barcode: custom ? (f.barcode && f.barcode.startsWith('2') ? f.barcode : generateEan13()) : editing ? f.barcode : '',
      word_code: custom ? f.word_code || generateWordCode(f.name || 'item') : f.word_code,
    }));
  };

  const margin = useMemo(() => {
    const p = Number(form.price), c = Number(form.cost);
    return p > 0 && c > 0 ? Math.round(((p - c) / p) * 100) : null;
  }, [form.price, form.cost]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      name: form.name.trim(),
      category: form.category?.trim() || null,
      description: form.description?.trim() || null,
      barcode: form.barcode ? normaliseCode(form.barcode) : null,
      word_code: form.word_code ? normaliseCode(form.word_code) : null,
      price: Number(form.price),
      cost: Number(form.cost) || 0,
      stock: Math.trunc(Number(form.stock) || 0),
      low_stock_threshold: Math.trunc(Number(form.low_stock_threshold) || 0),
    };
    if (!payload.barcode && !payload.word_code) {
      failure('Add a code', 'Scan/enter a barcode, or switch to "No barcode" to generate one.');
      return;
    }

    const priceChanged = editing && Number(product!.price) !== payload.price;
    const ok = await confirmAction({
      title: editing ? 'Save changes?' : 'Add this product?',
      html:
        `<b>${escape(payload.name)}</b> · ${fmtMoney(payload.price)}` +
        (priceChanged ? `<br/><span class="muted">Price: ${fmtMoney(product!.price)} → <b>${fmtMoney(payload.price)}</b></span>` : '') +
        (!isAdmin ? '<br/><br/><small>The admin will be notified of this change.</small>' : ''),
      confirmText: editing ? 'Save changes' : 'Add product',
    });
    if (!ok) return;

    setBusy(true);
    try {
      let saved: Product | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const q = editing
          ? supabase.from('products').update({ ...payload, stock: undefined }).eq('id', product!.id).select().single()
          : supabase.from('products').insert(payload).select().single();
        const { data, error } = await q;
        if (!error) {
          saved = data as Product;
          break;
        }
        // generated code collided (very rare) → regenerate and retry
        if (payload.is_custom && /duplicate key/.test(error.message) && !editing) {
          if (/barcode/.test(error.message)) payload.barcode = generateEan13();
          if (/word_code/.test(error.message)) payload.word_code = generateWordCode(payload.name);
          continue;
        }
        throw error;
      }
      if (!saved) throw new Error('Could not save product.');
      onSaved(saved);
      onClose();
      success(editing ? 'Changes saved' : 'Product added', saved.name);
    } catch (err) {
      failure('Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? 'Edit product' : 'New product'}
      subtitle={editing ? product!.name : 'Scan a barcode, or generate codes for store-owned items.'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button form="product-form" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 size={15} className="spin" />}
            {editing ? 'Save changes' : 'Add product'}
          </button>
        </>
      }
    >
      <form id="product-form" className="pform" onSubmit={save}>
        <div className="pform-main">
          <div className="seg seg-wide">
            <button type="button" className={!form.is_custom ? 'on' : ''} onClick={() => makeCustom(false)}>
              <Barcode size={15} /> Has a barcode
            </button>
            <button type="button" className={form.is_custom ? 'on' : ''} onClick={() => makeCustom(true)}>
              <Sparkles size={15} /> No barcode · own product
            </button>
            <i className={`seg-pill ${form.is_custom ? 'right' : ''}`} />
          </div>

          <label className="field">
            <span>Product name</span>
            <input className="input" required autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Homemade Ube Jam 250g" />
          </label>

          {!form.is_custom ? (
            <label className="field">
              <span>Barcode</span>
              <div className="row gap-sm">
                <input className="input mono grow" value={form.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or type the barcode" />
                <button type="button" className={`btn ${scanning ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setScanning((s) => !s)}>
                  <Camera size={15} /> {scanning ? 'Close' : 'Scan'}
                </button>
              </div>
              {scanning && (
                <div className="reveal" style={{ marginTop: 10 }}>
                  <CameraScanner
                    continuous={false}
                    onScan={(code) => {
                      beep();
                      set('barcode', code);
                      setScanning(false);
                    }}
                  />
                </div>
              )}
            </label>
          ) : (
            <div className="gen-codes reveal">
              <label className="field">
                <span>Generated barcode (EAN-13, in-store range)</span>
                <div className="row gap-sm">
                  <input className="input mono grow" value={form.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} />
                  <button type="button" className="btn btn-ghost" title="Regenerate" onClick={() => set('barcode', generateEan13())}>
                    <RefreshCw size={15} />
                  </button>
                </div>
              </label>
            </div>
          )}

          <label className="field">
            <span>
              Word code <small className="muted">— short, typeable & scannable</small>
            </span>
            <div className="row gap-sm">
              <input className="input mono grow" value={form.word_code ?? ''} onChange={(e) => set('word_code', e.target.value.toUpperCase())} placeholder="JEN-UBEJA-7K2Q" />
              <button type="button" className="btn btn-ghost" title="Generate from name" onClick={() => set('word_code', generateWordCode(form.name || 'item'))}>
                <Wand2 size={15} /> Generate
              </button>
            </div>
          </label>

          <div className="grid-2">
            <label className="field">
              <span>Category</span>
              <input className="input" list="cat-list" value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="Snacks" />
              <datalist id="cat-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Unit</span>
              <select className="input" value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                {['pc', 'pack', 'box', 'bottle', 'kg', 'g', 'L', 'ml', 'dozen', 'set'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Selling price</span>
              <input className="input" type="number" min="0" step="0.01" required value={form.price} onChange={(e) => set('price', e.target.value as unknown as number)} />
            </label>
            <label className="field">
              <span>
                Cost {margin !== null && <small className={`muted ${margin < 0 ? 'neg' : ''}`}>· {margin}% margin</small>}
              </span>
              <input className="input" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set('cost', e.target.value as unknown as number)} />
            </label>
            <label className="field">
              <span>{editing ? 'Stock (use “Adjust stock”)' : 'Starting stock'}</span>
              <input className="input" type="number" step="1" disabled={editing} value={form.stock} onChange={(e) => set('stock', e.target.value as unknown as number)} />
            </label>
            <label className="field">
              <span>Low-stock alert at</span>
              <input className="input" type="number" min="0" step="1" value={form.low_stock_threshold} onChange={(e) => set('low_stock_threshold', e.target.value as unknown as number)} />
            </label>
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea className="input" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Optional" />
          </label>

          {editing && isAdmin && (
            <label className="check">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
              <span>Active (visible at the register)</span>
            </label>
          )}
        </div>

        <aside className="pform-preview">
          <span className="eyebrow">Label preview</span>
          <div className="preview-card">
            <div className="preview-name display">{form.name || 'Product name'}</div>
            <div className="preview-price">{fmtMoney(form.price)}</div>
            {form.barcode || form.word_code ? (
              <CodeLabel name={form.name || 'Product'} price={Number(form.price)} barcode={form.barcode || null} wordCode={form.word_code || null} compact />
            ) : (
              <p className="muted small">Codes will appear here.</p>
            )}
          </div>
        </aside>
      </form>
    </Modal>
  );
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
