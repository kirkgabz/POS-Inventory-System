import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Barcode,
  Camera,
  CheckCircle2,
  ImagePlus,
  Info,
  Loader2,
  RefreshCw,
  ScanBarcode,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import Modal from './Modal';
import CameraScanner, { beep } from './CameraScanner';
import CodeLabel from './CodeLabel';
import { supabase, errorMessage } from '../lib/supabase';
import { choose, confirmAction, failure, success, toast } from '../lib/alerts';
import { normaliseCode, randomTail, wordCodeFor } from '../lib/codes';
import { decodeBarcodeFromImage } from '../lib/imageScan';
import { lookupBarcode } from '../lib/productLookup';
import { uniqueEan13, uploadProductPhoto } from '../lib/storage';
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
  /** Called when the scanned barcode already belongs to a product */
  onExisting?: (p: Product) => void;
}

type Step = 'choose' | 'form';
type Source = 'generated' | 'photo' | 'camera' | 'existing' | null;
type ScanState = 'idle' | 'reading' | 'lookup' | 'done' | 'failed';

const empty: ProductInput = {
  name: '',
  description: '',
  category: '',
  barcode: '',
  word_code: '',
  is_custom: false,
  image_url: null,
  price: 0,
  cost: 0,
  stock: 0,
  low_stock_threshold: 5,
  unit: 'pc',
  is_active: true,
};

export default function ProductForm({ open, onClose, product, initialCode, categories, onSaved, onExisting }: Props) {
  const { isAdmin } = useAuth();
  const editing = !!product;
  const [step, setStep] = useState<Step>('choose');
  const [form, setForm] = useState<ProductInput>(empty);
  const [source, setSource] = useState<Source>(null);
  const [scan, setScan] = useState<ScanState>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [reminder, setReminder] = useState(false);
  const [camera, setCamera] = useState(false);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const tail = useRef(randomTail());
  const wordTouched = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // reset every time the modal opens
  useEffect(() => {
    if (!open) return;
    setReminder(false);
    setCamera(false);
    setNote(null);
    setScan('idle');
    setPhoto(null);
    tail.current = randomTail();
    wordTouched.current = false;
    if (product) {
      const { id: _i, created_by: _c, updated_by: _u, created_at: _ca, updated_at: _ua, ...rest } = product;
      setForm({ ...rest, description: rest.description ?? '', category: rest.category ?? '', barcode: rest.barcode ?? '', word_code: rest.word_code ?? '' });
      setSource('existing');
      setStep('form');
      wordTouched.current = true;
    } else {
      setForm(empty);
      setSource(null);
      setStep(initialCode ? 'form' : 'choose');
      if (initialCode) handleDecoded(initialCode, 'camera');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product, initialCode]);

  // free the preview URL
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  // keep the word code in step with the name until the user edits it
  useEffect(() => {
    if (!editing && !wordTouched.current && step === 'form') {
      setForm((f) => ({ ...f, word_code: wordCodeFor(f.name || 'item', tail.current) }));
    }
  }, [form.name, editing, step]);

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  /* ---------- barcode sources ---------- */

  const generateCode = async () => {
    setReminder(false);
    setCamera(false);
    setStep('form');
    const code = await uniqueEan13();
    setForm((f) => ({ ...f, barcode: code, is_custom: true }));
    setSource('generated');
    setScan('idle');
    setNote('A unique barcode was generated for this product. Print the label and stick it on.');
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  async function handleDecoded(raw: string, src: 'photo' | 'camera') {
    const code = normaliseCode(raw);
    // Already in inventory?
    const { data: existing } = await supabase
      .from('products')
      .select('*')
      .or(`barcode.eq.${code},word_code.eq.${code}`)
      .maybeSingle();
    if (existing) {
      beep(false);
      const pick = await choose({
        title: 'Already in your inventory',
        html: `<b>${esc((existing as Product).name)}</b> already uses barcode <span class="mono">${esc(code)}</span>.`,
        icon: 'info',
        confirmText: onExisting ? 'Open that product' : 'Okay',
        denyText: 'Try another photo',
      });
      if (pick === 'confirm' && onExisting) {
        onClose();
        onExisting(existing as Product);
      } else if (pick === 'deny') {
        setReminder(true);
      }
      setScan('idle');
      return;
    }

    beep();
    setForm((f) => ({ ...f, barcode: code, is_custom: false }));
    setSource(src);
    setScan('lookup');
    setNote(null);

    const info = await lookupBarcode(code);
    if (info) {
      setForm((f) => ({
        ...f,
        name: f.name || info.name,
        category: f.category || info.category || '',
        description: f.description || [info.brand, info.quantity].filter(Boolean).join(' · '),
      }));
      setNote(`Barcode read and product found in ${info.source}. Check the details, then add price & stock.`);
      toast('Details filled in — please review');
    } else {
      setNote('Barcode read ✓ — but this product isn’t in the online database. Please type its name and details.');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
    setScan('done');
  }

  const onPhotoChosen = async (file: File | undefined) => {
    if (!file) return;
    setReminder(false);
    setStep('form');
    setPhoto({ file, url: URL.createObjectURL(file) });
    setScan('reading');
    setNote(null);
    let code: string | null = null;
    try {
      code = await decodeBarcodeFromImage(file);
    } catch {
      code = null;
    }
    if (!code) {
      setScan('failed');
      beep(false);
      const pick = await choose({
        title: 'No barcode found',
        html: 'We couldn’t read a barcode in that photo.<br/><small>Make sure the black lines and numbers are clear, flat and in focus.</small>',
        icon: 'warning',
        confirmText: 'Try another photo',
        denyText: 'Product has no barcode — generate one',
        cancelText: 'Fill in manually',
      });
      if (pick === 'confirm') setReminder(true);
      else if (pick === 'deny') generateCode();
      return;
    }
    await handleDecoded(code, 'photo');
  };

  /* ---------- save ---------- */

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
    if (!payload.barcode) {
      failure('No barcode yet', 'Upload a photo of the barcode, scan it with the camera, or generate one.');
      return;
    }

    const priceChanged = editing && Number(product!.price) !== payload.price;
    const loss = payload.cost > 0 && payload.price < payload.cost;
    const ok = await confirmAction({
      title: editing ? 'Save changes?' : 'Add this product?',
      html:
        `<b>${esc(payload.name)}</b> · ${fmtMoney(payload.price)}<br/><span class="mono small">${esc(payload.barcode)}</span>` +
        (priceChanged ? `<br/><span class="muted">Price: ${fmtMoney(product!.price)} → <b>${fmtMoney(payload.price)}</b></span>` : '') +
        (loss ? `<br/><br/><b style="color:var(--danger)">Heads up: the price is lower than the cost.</b>` : '') +
        (!isAdmin ? '<br/><br/><small>The admin will be notified of this change.</small>' : ''),
      confirmText: editing ? 'Save changes' : 'Add product',
      icon: loss ? 'warning' : 'question',
    });
    if (!ok) return;

    setBusy(true);
    try {
      if (photo) payload.image_url = await uploadProductPhoto(photo.file);

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
        // a generated code collided (extremely rare) → regenerate and retry
        if (!editing && /duplicate key/.test(error.message)) {
          if (/word_code/.test(error.message)) payload.word_code = wordCodeFor(payload.name, randomTail());
          else if (/barcode/.test(error.message) && payload.is_custom) payload.barcode = await uniqueEan13();
          else throw error;
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

  /* ---------- UI ---------- */

  const sourceBadge = {
    generated: { icon: <Sparkles size={12} />, text: 'Generated' },
    photo: { icon: <ImagePlus size={12} />, text: 'From photo' },
    camera: { icon: <Camera size={12} />, text: 'Scanned' },
    existing: { icon: <Barcode size={12} />, text: 'Saved' },
  } as const;

  const imageShown = photo?.url ?? form.image_url ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? 'Edit product' : 'New product'}
      subtitle={
        editing
          ? product!.name
          : step === 'choose'
            ? 'How would you like to add it?'
            : 'Review the details, then add price and stock.'
      }
      footer={
        step === 'form' ? (
          <>
            {!editing && (
              <button type="button" className="btn btn-ghost mr-auto" onClick={() => setStep('choose')}>
                Start over
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button form="product-form" className="btn btn-primary" disabled={busy || scan === 'reading' || scan === 'lookup'}>
              {busy && <Loader2 size={15} className="spin" />}
              {editing ? 'Save changes' : 'Add product'}
            </button>
          </>
        ) : undefined
      }
    >
      {/* hidden file inputs (labels open them — works on every browser) */}
      <input id="pf-photo-scan" type="file" accept="image/*" hidden onChange={(e) => { onPhotoChosen(e.target.files?.[0]); e.target.value = ''; }} />
      <input
        id="pf-photo-only"
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setPhoto({ file: f, url: URL.createObjectURL(f) });
          e.target.value = '';
        }}
      />

      {step === 'choose' && (
        <div className="choose reveal">
          <button type="button" className="choose-card" onClick={() => setReminder(true)}>
            <span className="choose-icon"><ScanBarcode size={26} strokeWidth={1.5} /></span>
            <strong className="display">Upload product photo</strong>
            <span>We read the barcode from the photo and fill in the name for you.</span>
            <em>Recommended for branded items</em>
          </button>
          <button type="button" className="choose-card" onClick={generateCode}>
            <span className="choose-icon accent"><Sparkles size={26} strokeWidth={1.5} /></span>
            <strong className="display">No barcode · own product</strong>
            <span>The system creates a unique barcode and word code you can print as a label.</span>
            <em>For home-made, repacked or store-owned items</em>
          </button>
          <button
            type="button"
            className="link choose-alt"
            onClick={() => {
              setStep('form');
              setCamera(true);
            }}
          >
            <Camera size={14} /> Or scan the barcode with the live camera
          </button>
        </div>
      )}

      {step === 'form' && (
        <form id="product-form" className="pform reveal" onSubmit={save}>
          <div className="pform-main">
            {note && (
              <div className={`note ${scan === 'done' || source === 'generated' ? 'ok' : ''}`}>
                {scan === 'done' || source === 'generated' ? <CheckCircle2 size={16} /> : <Info size={16} />}
                <span>{note}</span>
              </div>
            )}

            <label className="field">
              <span>
                Barcode {source && <span className="tag">{sourceBadge[source].icon} {sourceBadge[source].text}</span>}
              </span>
              <div className="row gap-sm">
                <input
                  className="input mono grow"
                  readOnly
                  value={form.barcode ?? ''}
                  placeholder={scan === 'reading' ? 'Reading the photo…' : 'Upload a photo, scan, or generate'}
                />
                {!editing && (
                  <>
                    <label htmlFor="pf-photo-scan" className="btn btn-ghost" title="Read barcode from a photo" onClick={(e) => { e.preventDefault(); setReminder(true); }}>
                      <ImagePlus size={15} />
                    </label>
                    <button type="button" className={`btn ${camera ? 'btn-primary' : 'btn-ghost'}`} title="Scan with camera" onClick={() => setCamera((c) => !c)}>
                      <Camera size={15} />
                    </button>
                    <button type="button" className="btn btn-ghost" title="Generate a new barcode" onClick={generateCode}>
                      <RefreshCw size={15} />
                    </button>
                  </>
                )}
              </div>
              {camera && (
                <div className="reveal" style={{ marginTop: 10 }}>
                  <CameraScanner
                    continuous={false}
                    onScan={(code) => {
                      setCamera(false);
                      handleDecoded(code, 'camera');
                    }}
                  />
                </div>
              )}
            </label>

            <label className="field">
              <span>Product name</span>
              <input ref={nameRef} className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={scan === 'lookup' ? 'Looking up product…' : 'e.g. Blue Hair Clip'} />
            </label>

            <label className="field">
              <span>
                Word code <small className="muted">— short, typeable & scannable</small>
              </span>
              <div className="row gap-sm">
                <input
                  className="input mono grow"
                  value={form.word_code ?? ''}
                  onChange={(e) => {
                    wordTouched.current = true;
                    set('word_code', e.target.value.toUpperCase());
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  title="Generate from name"
                  onClick={() => {
                    tail.current = randomTail();
                    set('word_code', wordCodeFor(form.name || 'item', tail.current));
                  }}
                >
                  <Wand2 size={15} /> New
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
              <textarea className="input" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Brand, size, supplier… (optional)" />
            </label>

            {editing && isAdmin && (
              <label className="check">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                <span>Active (visible at the register)</span>
              </label>
            )}
          </div>

          <aside className="pform-preview">
            <span className="eyebrow">Photo</span>
            <div className={`photo-box ${scan === 'reading' || scan === 'lookup' ? 'scanning' : ''}`}>
              {imageShown ? (
                <img src={imageShown} alt="Product" />
              ) : (
                <label htmlFor="pf-photo-only" className="photo-empty">
                  <ImagePlus size={22} strokeWidth={1.4} />
                  <span>Add a photo (optional)</span>
                </label>
              )}
              {(scan === 'reading' || scan === 'lookup') && (
                <div className="photo-scan">
                  <i className="scanner-laser" />
                  <span>{scan === 'reading' ? 'Reading barcode…' : 'Looking up product…'}</span>
                </div>
              )}
            </div>
            {imageShown && (
              <label htmlFor="pf-photo-only" className="link small" style={{ justifySelf: 'center', cursor: 'pointer' }}>
                Change photo
              </label>
            )}

            <span className="eyebrow" style={{ marginTop: 8 }}>Label preview</span>
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
      )}

      {/* Reminder card shown BEFORE choosing a photo */}
      {reminder && (
        <div className="reminder-scrim" onMouseDown={(e) => e.target === e.currentTarget && setReminder(false)}>
          <div className="reminder-card" role="dialog" aria-modal="true">
            <button type="button" className="icon-btn notif-close" onClick={() => setReminder(false)} aria-label="Close">
              <X size={16} />
            </button>
            <div className="reminder-art" aria-hidden>
              <div className="ra-box">
                <div className="ra-bars">
                  {Array.from({ length: 22 }).map((_, i) => (
                    <i key={i} style={{ width: [1, 2, 1, 3, 1, 2][i % 6] }} />
                  ))}
                </div>
                <span className="mono">4 801234 567890</span>
              </div>
              <i className="ra-laser" />
            </div>
            <h3 className="display">Make sure the barcode shows</h3>
            <p className="muted">
              Take or choose a photo where the product's <b>barcode — the black lines and numbers</b> — is clearly visible. A photo of only the name or front label can't be read.
            </p>
            <ul className="tips">
              <li>Fill most of the photo with the barcode</li>
              <li>Good light, no glare, not blurry</li>
              <li>Hold it flat and straight</li>
            </ul>
            <label htmlFor="pf-photo-scan" className="btn btn-primary btn-block">
              <ImagePlus size={16} /> Choose or take photo
            </label>
            <button type="button" className="btn btn-ghost btn-block" onClick={generateCode}>
              <Sparkles size={15} /> Product has no barcode — generate one
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
