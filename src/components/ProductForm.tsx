import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Barcode,
  Camera,
  Carrot,
  ChefHat,
  Layers,
  CheckCircle2,
  ImagePlus,
  Info,
  ListPlus,
  Loader2,
  Package,
  RefreshCw,
  ScanBarcode,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
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
import { INGREDIENT_UNITS, recipeCost } from '../lib/recipes';
import type { Product, ProductInput, ProductKind } from '../lib/types';

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
  kind: 'item',
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
  // "Buying by pack": cost is entered for the whole pack and split per piece
  const [costMode, setCostMode] = useState<'piece' | 'pack'>('piece');
  const [pack, setPack] = useState({ price: '', size: '12', count: '1' });
  const [fillStock, setFillStock] = useState(true);
  // menu items: their recipe (ingredient + amount per serving)
  const [recipe, setRecipe] = useState<{ ingredient_id: string; qty: string }[]>([]);
  const [ingredients, setIngredients] = useState<Product[]>([]);
  // menu items: add-ons & options · combos: what's inside
  const [opts, setOpts] = useState<OptDraft[]>([]);
  const [combo, setCombo] = useState<{ component_id: string; qty: string }[]>([]);
  const [sellables, setSellables] = useState<Product[]>([]);
  const kind: ProductKind = form.kind ?? 'item';
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
    setFillStock(true);
    setRecipe([]);
    setOpts([]);
    setCombo([]);
    if (product && product.kind === 'menu') {
      (async () => {
        const { data: o } = await supabase.from('menu_options').select('id, name, price_delta, sort').eq('menu_id', product.id).order('sort');
        const list = (o ?? []) as { id: string; name: string; price_delta: number }[];
        if (!list.length) return;
        const { data: items } = await supabase.from('menu_option_items').select('option_id, ingredient_id, qty').in('option_id', list.map((x) => x.id));
        const rows = (items ?? []) as { option_id: string; ingredient_id: string; qty: number }[];
        setOpts(
          list.map((x) => ({
            id: x.id,
            name: x.name,
            price: String(Number(x.price_delta)),
            items: rows
              .filter((it) => it.option_id === x.id)
              .map((it) => ({ ingredient_id: it.ingredient_id, mode: it.qty < 0 ? 'less' : 'more', qty: String(Math.abs(it.qty)) })),
          })),
        );
      })();
    }
    if (product && product.kind === 'combo') {
      supabase
        .from('combo_items')
        .select('component_id, qty')
        .eq('combo_id', product.id)
        .then(({ data }) => setCombo(((data ?? []) as { component_id: string; qty: number }[]).map((c) => ({ component_id: c.component_id, qty: String(c.qty) }))));
    }
    if (product && product.kind === 'menu') {
      supabase
        .from('recipe_items')
        .select('ingredient_id, qty')
        .eq('menu_id', product.id)
        .then(({ data }) => setRecipe(((data ?? []) as { ingredient_id: string; qty: number }[]).map((l) => ({ ingredient_id: l.ingredient_id, qty: String(l.qty) }))));
    }
    if (product?.pack_size && product.pack_size > 1) {
      setCostMode('pack');
      setPack({ price: String(round2(Number(product.cost) * product.pack_size)), size: String(product.pack_size), count: '1' });
    } else {
      setCostMode('piece');
      setPack({ price: '', size: '12', count: '1' });
    }
    if (product) {
      const { id: _i, created_by: _c, updated_by: _u, created_at: _ca, updated_at: _ua, ...rest } = product;
      setForm({ ...rest, kind: rest.kind ?? 'item', description: rest.description ?? '', category: rest.category ?? '', barcode: rest.barcode ?? '', word_code: rest.word_code ?? '' });
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

  // ingredients to choose from (menu items only)
  useEffect(() => {
    if (!open || kind !== 'menu') return;
    supabase
      .from('products')
      .select('*')
      .eq('kind', 'ingredient')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setIngredients(((data as Product[]) ?? []).map((p) => ({ ...p, cost: Number(p.cost) }))));
  }, [open, kind]);

  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  // things a combo can contain (items and menu items)
  useEffect(() => {
    if (!open || kind !== 'combo') return;
    supabase
      .from('products')
      .select('*')
      .in('kind', ['item', 'menu'])
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setSellables(((data as Product[]) ?? []).filter((p) => p.id !== product?.id).map((p) => ({ ...p, price: Number(p.price), cost: Number(p.cost) }))));
  }, [open, kind, product?.id]);
  const sellById = useMemo(() => new Map(sellables.map((p) => [p.id, p])), [sellables]);
  const comboLines = useMemo(
    () => combo.filter((c) => c.component_id && Math.trunc(Number(c.qty)) > 0).map((c) => ({ component_id: c.component_id, qty: Math.trunc(Number(c.qty)) })),
    [combo],
  );
  const comboCost = useMemo(() => comboLines.reduce((s, c) => s + Number(sellById.get(c.component_id)?.cost ?? 0) * c.qty, 0), [comboLines, sellById]);
  const comboRegular = useMemo(() => comboLines.reduce((s, c) => s + Number(sellById.get(c.component_id)?.price ?? 0) * c.qty, 0), [comboLines, sellById]);
  useEffect(() => {
    if (kind === 'combo') setForm((f) => ({ ...f, cost: round4(comboCost) }));
  }, [kind, comboCost]);
  const recipeLines = useMemo(
    () => recipe.filter((l) => l.ingredient_id && Math.trunc(Number(l.qty)) > 0).map((l) => ({ ingredient_id: l.ingredient_id, qty: Math.trunc(Number(l.qty)) })),
    [recipe],
  );
  const servingCost = useMemo(() => recipeCost(recipeLines, ingById), [recipeLines, ingById]);
  const makeable = useMemo(
    () => (recipeLines.length ? Math.min(...recipeLines.map((l) => Math.floor(Math.max(0, ingById.get(l.ingredient_id)?.stock ?? 0) / l.qty))) : null),
    [recipeLines, ingById],
  );
  // a menu item's cost is its recipe cost
  useEffect(() => {
    if (kind === 'menu') setForm((f) => ({ ...f, cost: round4(servingCost) }));
  }, [kind, servingCost]);

  const setKind = (k: ProductKind) => {
    setForm((f) => ({
      ...f,
      kind: k,
      unit: k === 'ingredient' ? (INGREDIENT_UNITS.includes(f.unit) ? f.unit : 'g') : k === 'menu' ? 'pc' : k === 'combo' ? 'set' : f.unit,
      price: k === 'ingredient' ? 0 : f.price,
    }));
    if (k === 'menu' || k === 'combo') setCostMode('piece');
  };

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

  // pack mode → derive the per-piece cost (and starting stock for new products)
  const packPrice = Number(pack.price) || 0;
  const packSize = Math.trunc(Number(pack.size) || 0);
  const packCount = Math.max(0, Math.trunc(Number(pack.count) || 0));
  useEffect(() => {
    if (costMode !== 'pack') return;
    const unitCost = packPrice > 0 && packSize >= 2 ? round4(packPrice / packSize) : 0;
    setForm((f) => ({
      ...f,
      cost: unitCost,
      stock: !editing && fillStock && packSize >= 2 ? packCount * packSize : f.stock,
    }));
  }, [costMode, packPrice, packSize, packCount, fillStock, editing]);

  const profit = useMemo(() => {
    const p = Number(form.price), c = Number(form.cost);
    if (!(p > 0) || !(c > 0)) return null;
    return { each: p - c, margin: Math.round(((p - c) / p) * 1000) / 10, cost: c };
  }, [form.price, form.cost]);

  const switchToPack = () => {
    // the number typed as cost was really the price of a whole pack
    setPack((pk) => ({ ...pk, price: String(Number(form.cost) || pk.price) }));
    setCostMode('pack');
  };

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
      kind,
      pack_size: costMode === 'pack' && kind !== 'menu' && kind !== 'combo' ? packSize : null,
      stock: kind === 'menu' || kind === 'combo' ? 0 : Math.trunc(Number(form.stock) || 0),
      low_stock_threshold: Math.trunc(Number(form.low_stock_threshold) || 0),
    };
    if (!payload.barcode) {
      failure('No barcode yet', 'Upload a photo of the barcode, scan it with the camera, or generate one.');
      return;
    }
    if (kind === 'ingredient') payload.price = 0;
    if (kind === 'menu') payload.cost = round4(servingCost);
    if (kind === 'combo') payload.cost = round4(comboCost);
    if (kind === 'combo' && comboLines.length === 0) {
      failure('Combo is empty', 'Add what goes in this meal, e.g. Burger, Fries and a drink.');
      return;
    }
    const badOpt = kind === 'menu' ? opts.find((o) => !o.name.trim()) : undefined;
    if (badOpt) {
      failure('Name every add-on', 'Each add-on or option needs a name, e.g. "Extra patty" or "No veggies".');
      return;
    }
    if (kind === 'menu' && recipeLines.length === 0) {
      failure('Recipe is empty', 'Add at least one ingredient and how much one serving uses.');
      return;
    }
    if (costMode === 'pack' && kind !== 'menu' && kind !== 'combo' && (!(packPrice > 0) || packSize < 2)) {
      failure('Pack details missing', 'Enter the price of one pack and how many pieces are inside (2 or more).');
      return;
    }

    const priceChanged = editing && Number(product!.price) !== payload.price;
    const loss = kind !== 'ingredient' && payload.cost > 0 && payload.price < payload.cost;
    const each = payload.price - payload.cost;
    const ok = await confirmAction({
      title: editing ? 'Save changes?' : 'Add this product?',
      html:
        `<b>${esc(payload.name)}</b> · ${kind === 'ingredient' ? `Ingredient · ${fmtMoney(payload.cost)} per ${esc(payload.unit)}` : `${fmtMoney(payload.price)} per ${esc(payload.unit)}`}<br/>` +
        (kind === 'menu' ? `<span class="muted">${recipeLines.length} ingredient(s) in the recipe${opts.length ? ` · ${opts.length} add-on(s)` : ''}</span><br/>` : '') +
        (kind === 'combo' ? `<span class="muted">${comboLines.length} item(s) inside${comboRegular > Number(form.price) ? ` · customer saves ${fmtMoney(comboRegular - Number(form.price))}` : ''}</span><br/>` : '') +
        `<span class="mono small">${esc(payload.barcode)}</span>` +
        (priceChanged ? `<br/><span class="muted">Price: ${fmtMoney(product!.price)} → <b>${fmtMoney(payload.price)}</b></span>` : '') +
        (payload.cost > 0 && !loss && kind !== 'ingredient'
          ? `<br/><span class="muted">Cost ${fmtMoney(payload.cost)} · profit <b>${fmtMoney(each)}</b> per ${esc(payload.unit)}` +
            (costMode === 'pack' ? ` · <b>${fmtMoney(each * packSize)}</b> per pack of ${packSize}` : '') +
            '</span>'
          : '') +
        (!editing && costMode === 'pack' && fillStock ? `<br/><span class="muted">Starting stock: ${packCount} pack(s) × ${packSize} = <b>${payload.stock}</b></span>` : '') +
        (loss
          ? `<br/><br/><b style="color:var(--danger)">Heads up: you'd lose ${fmtMoney(-each)} on every ${esc(payload.unit)} sold.</b>` +
            (costMode === 'piece' ? `<br/><small>If ${fmtMoney(payload.cost)} is the price of a whole pack, go back and switch Cost to <b>Per pack</b>.</small>` : '')
          : '') +
        (!isAdmin ? '<br/><br/><small>The store owner will be notified of this change.</small>' : ''),
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
        // database not yet upgraded with migration 009 → save without the pack size
        if (/pack_size/.test(error.message) && 'pack_size' in payload) {
          delete (payload as { pack_size?: number | null }).pack_size;
          payload.cost = round2(payload.cost);
          continue;
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
      // keep the recipe in step with the menu item
      if (kind === 'menu' || product?.kind === 'menu') {
        const { error: delErr } = await supabase.from('recipe_items').delete().eq('menu_id', saved.id);
        if (delErr) throw delErr;
        if (kind === 'menu' && recipeLines.length) {
          const { error: insErr } = await supabase
            .from('recipe_items')
            .insert(recipeLines.map((l) => ({ menu_id: saved!.id, ingredient_id: l.ingredient_id, qty: l.qty })));
          if (insErr) throw insErr;
        }
      }
      // add-ons & options
      if (kind === 'menu' || product?.kind === 'menu') await saveOptions(saved.id, kind === 'menu' ? opts : []);
      // what's inside a combo
      if (kind === 'combo' || product?.kind === 'combo') {
        const { error: delC } = await supabase.from('combo_items').delete().eq('combo_id', saved.id);
        if (delC) throw delC;
        if (kind === 'combo' && comboLines.length) {
          const { error: insC } = await supabase.from('combo_items').insert(comboLines.map((c) => ({ combo_id: saved!.id, component_id: c.component_id, qty: c.qty })));
          if (insC) throw insC;
        }
      }
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
          <div className="choose-food">
            <span className="muted small">Food &amp; drinks you make?</span>
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                setKind('menu');
                generateCode();
              }}
            >
              <ChefHat size={14} /> Menu item with a recipe
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                setKind('ingredient');
                generateCode();
              }}
            >
              <Carrot size={14} /> Ingredient
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                setKind('combo');
                generateCode();
              }}
            >
              <Layers size={14} /> Combo meal
            </button>
          </div>
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

            <div className="kind-pick">
              <span className="muted small">This is</span>
              <span className="mini-seg" role="group" aria-label="Product kind">
                <button type="button" className={kind === 'item' ? 'on' : ''} onClick={() => setKind('item')}>
                  <Package size={12} /> Item
                </button>
                <button type="button" className={kind === 'menu' ? 'on' : ''} onClick={() => setKind('menu')}>
                  <ChefHat size={12} /> Menu item
                </button>
                <button type="button" className={kind === 'combo' ? 'on' : ''} onClick={() => setKind('combo')}>
                  <Layers size={12} /> Combo
                </button>
                <button type="button" className={kind === 'ingredient' ? 'on' : ''} onClick={() => setKind('ingredient')}>
                  <Carrot size={12} /> Ingredient
                </button>
              </span>
              <small className="muted kind-hint">
                {kind === 'menu'
                  ? 'Made to order — selling it uses up its ingredients.'
                  : kind === 'combo'
                    ? 'A meal or bundle — selling it uses up everything inside.'
                  : kind === 'ingredient'
                    ? 'Used in recipes. Not sold at the register.'
                    : 'Sold as is, with its own stock.'}
              </small>
            </div>

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
              <input ref={nameRef} className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={scan === 'lookup' ? 'Looking up product…' : kind === 'combo' ? 'e.g. Burger Meal' : kind === 'menu' ? 'e.g. Classic Burger' : kind === 'ingredient' ? 'e.g. Burger patty' : 'e.g. Blue Hair Clip'} />
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
                  {(kind === 'ingredient'
                    ? [...INGREDIENT_UNITS, 'kg', 'L']
                    : kind === 'menu' || kind === 'combo'
                      ? ['pc', 'serving', 'order', 'cup', 'set', 'meal', 'bottle']
                      : ['pc', 'pack', 'box', 'bottle', 'kg', 'g', 'L', 'ml', 'dozen', 'set']
                  )
                    .concat(form.unit && ![...INGREDIENT_UNITS, 'kg', 'L', 'pc', 'serving', 'order', 'cup', 'set', 'meal', 'bottle', 'pack', 'box', 'dozen'].includes(form.unit) ? [form.unit] : [])
                    .map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
              {kind !== 'ingredient' && (
                <label className="field">
                  <span>
                    Selling price <small className="muted">— per {form.unit}</small>
                  </span>
                  <input className="input" type="number" min="0" step="0.01" required value={form.price} onChange={(e) => set('price', e.target.value as unknown as number)} />
                </label>
              )}
              {kind === 'combo' ? (
                <div className="field">
                  <span>Cost per {form.unit}</span>
                  <input className="input" readOnly tabIndex={-1} value={comboLines.length ? `${fmtMoney(comboCost)} from what's inside` : 'Add what goes in it below'} />
                </div>
              ) : kind === 'menu' ? (
                <div className="field">
                  <span>Cost per {form.unit}</span>
                  <input className="input" readOnly tabIndex={-1} value={recipeLines.length ? `${fmtMoney(servingCost)} from the recipe` : 'Add ingredients below'} />
                </div>
              ) : (
              <div className="field">
                <span className="cost-head">
                  Cost
                  <span className="mini-seg" role="group" aria-label="How the cost is entered">
                    <button type="button" className={costMode === 'piece' ? 'on' : ''} onClick={() => setCostMode('piece')}>
                      Per {form.unit}
                    </button>
                    <button type="button" className={costMode === 'pack' ? 'on' : ''} onClick={() => setCostMode('pack')}>
                      <Package size={12} /> Per pack
                    </button>
                  </span>
                </span>
                {costMode === 'piece' ? (
                  <input className="input" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set('cost', e.target.value as unknown as number)} placeholder="What you paid for one" />
                ) : (
                  <input className="input" readOnly tabIndex={-1} value={Number(form.cost) > 0 ? `${fmtMoney(Number(form.cost))} per ${form.unit}` : 'Fill in the pack below'} />
                )}
              </div>
              )}

              {kind === 'menu' && (
                <RecipeBuilder
                  recipe={recipe}
                  setRecipe={setRecipe}
                  ingredients={ingredients}
                  ingById={ingById}
                  cost={servingCost}
                  makeable={makeable}
                  unit={form.unit}
                />
              )}
              {kind === 'menu' && ingredients.length > 0 && <OptionsBuilder opts={opts} setOpts={setOpts} ingredients={ingredients} ingById={ingById} />}
              {kind === 'combo' && (
                <ComboBuilder
                  combo={combo}
                  setCombo={setCombo}
                  sellables={sellables}
                  sellById={sellById}
                  cost={comboCost}
                  regular={comboRegular}
                  price={Number(form.price) || 0}
                />
              )}

              {costMode === 'pack' && (
                <div className="pack-box reveal">
                  <div className="pack-row">
                    <label className="field">
                      <span>Pack price</span>
                      <input className="input" type="number" min="0" step="0.01" value={pack.price} onChange={(e) => setPack((p) => ({ ...p, price: e.target.value }))} placeholder="e.g. 250" autoFocus />
                    </label>
                    <span className="pack-op" aria-hidden>÷</span>
                    <label className="field">
                      <span>{kind === 'ingredient' ? `${form.unit} per pack` : 'Pieces per pack'}</span>
                      <input className="input" type="number" min="2" step="1" value={pack.size} onChange={(e) => setPack((p) => ({ ...p, size: e.target.value }))} />
                    </label>
                    <span className="pack-op" aria-hidden>=</span>
                    <div className="pack-result">
                      <small>Cost per {form.unit}</small>
                      <b>{packPrice > 0 && packSize >= 2 ? fmtMoney(packPrice / packSize) : '—'}</b>
                    </div>
                  </div>
                  {!editing && (
                    <div className="pack-stock">
                      <label className="check">
                        <input type="checkbox" checked={fillStock} onChange={(e) => setFillStock(e.target.checked)} />
                        <span>Add to starting stock</span>
                      </label>
                      {fillStock && (
                        <span className="pack-count">
                          <input className="input" type="number" min="0" step="1" value={pack.count} onChange={(e) => setPack((p) => ({ ...p, count: e.target.value }))} aria-label="Packs bought" />
                          pack(s) × {packSize || '?'} = <b>{packCount * packSize || 0} {form.unit}</b>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {profit && (
                <div className={`profit-strip reveal ${profit.each < 0 ? 'loss' : profit.margin < 10 ? 'thin' : 'ok'}`}>
                  {profit.each < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                  <div>
                    {profit.each < 0 ? (
                      <>
                        <b>Loss of {fmtMoney(-profit.each)} per {form.unit}</b> — the selling price is lower than the cost.
                        {costMode === 'piece' && kind !== 'menu' && kind !== 'combo' ? (
                          <>
                            {' '}Is {fmtMoney(profit.cost)} the price of a whole pack?{' '}
                            <button type="button" className="link" onClick={switchToPack}>
                              Switch to per pack
                            </button>
                          </>
                        ) : (
                          <> Raise the selling price above {fmtMoney(profit.cost)}.</>
                        )}
                      </>
                    ) : (
                      <>
                        Profit <b>{fmtMoney(profit.each)}</b> per {form.unit} · <b>{profit.margin}%</b> margin
                        {costMode === 'pack' && packSize >= 2 && (
                          <>
                            {' '}· <b>{fmtMoney(profit.each * packSize)}</b> per pack of {packSize}
                          </>
                        )}
                        {profit.margin < 10 && <span className="muted"> — thin margin</span>}
                      </>
                    )}
                  </div>
                </div>
              )}

              {kind !== 'menu' && kind !== 'combo' && (
              <>
              <label className="field">
                <span>{editing ? 'Stock (use “Adjust stock”)' : `Starting stock (${form.unit})`}</span>
                <input
                  className="input"
                  type="number"
                  step="1"
                  disabled={editing || (costMode === 'pack' && fillStock)}
                  value={form.stock}
                  onChange={(e) => set('stock', e.target.value as unknown as number)}
                />
              </label>
              <label className="field">
                <span>Low-stock alert at</span>
                <input className="input" type="number" min="0" step="1" value={form.low_stock_threshold} onChange={(e) => set('low_stock_threshold', e.target.value as unknown as number)} />
              </label>
              </>
              )}
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

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ---------- recipe builder (menu items) ---------- */

function RecipeBuilder({
  recipe,
  setRecipe,
  ingredients,
  ingById,
  cost,
  makeable,
  unit,
}: {
  recipe: { ingredient_id: string; qty: string }[];
  setRecipe: (fn: (r: { ingredient_id: string; qty: string }[]) => { ingredient_id: string; qty: string }[]) => void;
  ingredients: Product[];
  ingById: Map<string, Product>;
  cost: number;
  makeable: number | null;
  unit: string;
}) {
  const used = new Set(recipe.map((l) => l.ingredient_id));
  const update = (i: number, patch: Partial<{ ingredient_id: string; qty: string }>) =>
    setRecipe((r) => r.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="recipe-box reveal">
      <div className="recipe-head">
        <span>
          <ChefHat size={15} /> <b>Recipe</b> <span className="muted">— what one {unit} uses</span>
        </span>
        {makeable !== null && (
          <span className={`recipe-make ${makeable <= 0 ? 'none' : makeable <= 5 ? 'low' : ''}`}>
            Can make <b>{makeable}</b> now
          </span>
        )}
      </div>

      {ingredients.length === 0 ? (
        <p className="muted small">
          No ingredients yet. Save this, then add ingredients first: <b>Add product → Ingredient</b> (e.g. Bun in pc, Patty in pc, Mayonnaise in ml).
        </p>
      ) : (
        <>
          {recipe.map((l, i) => {
            const ing = ingById.get(l.ingredient_id);
            const q = Math.trunc(Number(l.qty)) || 0;
            return (
              <div key={i} className="recipe-line">
                <select className="input" value={l.ingredient_id} onChange={(e) => update(i, { ingredient_id: e.target.value })} aria-label="Ingredient">
                  <option value="">Choose ingredient…</option>
                  {ingredients
                    .filter((x) => x.id === l.ingredient_id || !used.has(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.stock} {x.unit} left)
                      </option>
                    ))}
                </select>
                <div className="recipe-qty">
                  <input className="input" type="number" min="1" step="1" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} aria-label="Amount" />
                  <span className="muted">{ing?.unit ?? ''}</span>
                </div>
                <span className="recipe-cost">{ing && q > 0 ? fmtMoney(Number(ing.cost) * q) : '—'}</span>
                <button type="button" className="icon-btn danger" onClick={() => setRecipe((r) => r.filter((_, j) => j !== i))} aria-label="Remove ingredient">
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
          <div className="recipe-foot">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={used.size >= ingredients.length}
              onClick={() => setRecipe((r) => [...r, { ingredient_id: '', qty: '1' }])}
            >
              + Add ingredient
            </button>
            <span>
              Cost per {unit}: <b>{fmtMoney(cost)}</b>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- add-ons & options (menu items) ---------- */

interface OptDraft {
  id: string;
  name: string;
  price: string;
  items: { ingredient_id: string; mode: 'more' | 'less'; qty: string }[];
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Replace a menu item's options in the database (keeps ids so open orders stay valid). */
async function saveOptions(menuId: string, opts: OptDraft[]) {
  const keep = opts.map((o) => o.id);
  let del = supabase.from('menu_options').delete().eq('menu_id', menuId);
  if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`);
  const { error: e1 } = await del;
  if (e1) throw e1;
  if (!opts.length) return;
  const { error: e2 } = await supabase.from('menu_options').upsert(
    opts.map((o, i) => ({ id: o.id, menu_id: menuId, name: o.name.trim(), price_delta: Number(o.price) || 0, sort: i })),
  );
  if (e2) throw e2;
  const { error: e3 } = await supabase.from('menu_option_items').delete().in('option_id', keep);
  if (e3) throw e3;
  const rows = opts.flatMap((o) =>
    o.items
      .filter((it) => it.ingredient_id && Math.trunc(Number(it.qty)) > 0)
      .map((it) => ({ option_id: o.id, ingredient_id: it.ingredient_id, qty: (it.mode === 'less' ? -1 : 1) * Math.trunc(Number(it.qty)) })),
  );
  // one row per ingredient per option
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.option_id + r.ingredient_id) ? false : (seen.add(r.option_id + r.ingredient_id), true)));
  if (unique.length) {
    const { error: e4 } = await supabase.from('menu_option_items').insert(unique);
    if (e4) throw e4;
  }
}

function OptionsBuilder({
  opts,
  setOpts,
  ingredients,
  ingById,
}: {
  opts: OptDraft[];
  setOpts: (fn: (o: OptDraft[]) => OptDraft[]) => void;
  ingredients: Product[];
  ingById: Map<string, Product>;
}) {
  const patch = (i: number, p: Partial<OptDraft>) => setOpts((o) => o.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const patchItem = (i: number, k: number, p: Partial<OptDraft['items'][number]>) =>
    setOpts((o) => o.map((x, j) => (j === i ? { ...x, items: x.items.map((it, m) => (m === k ? { ...it, ...p } : it)) } : x)));

  return (
    <div className="recipe-box reveal">
      <div className="recipe-head">
        <span>
          <ListPlus size={15} /> <b>Add-ons &amp; options</b> <span className="muted">— chosen at the register</span>
        </span>
      </div>
      {opts.length === 0 && <p className="muted small">e.g. “Extra patty” +₱30 uses 1 more patty · “No veggies” leaves out the lettuce and tomato.</p>}
      {opts.map((o, i) => (
        <div key={o.id} className="opt-edit">
          <div className="opt-edit-head">
            <input className="input grow" value={o.name} maxLength={60} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Name, e.g. Extra patty" aria-label="Add-on name" />
            <div className="opt-price">
              <span className="muted">+₱</span>
              <input className="input" type="number" step="0.01" value={o.price} onChange={(e) => patch(i, { price: e.target.value })} aria-label="Extra price" />
            </div>
            <button type="button" className="icon-btn danger" onClick={() => setOpts((x) => x.filter((_, j) => j !== i))} aria-label="Remove add-on">
              <Trash2 size={15} />
            </button>
          </div>
          {o.items.map((it, k) => (
            <div key={k} className="opt-item">
              <select className="input" value={it.mode} onChange={(e) => patchItem(i, k, { mode: e.target.value as 'more' | 'less' })} aria-label="Uses more or less">
                <option value="more">Uses more</option>
                <option value="less">Leaves out</option>
              </select>
              <input className="input" type="number" min="1" step="1" value={it.qty} onChange={(e) => patchItem(i, k, { qty: e.target.value })} aria-label="Amount" />
              <select className="input" value={it.ingredient_id} onChange={(e) => patchItem(i, k, { ingredient_id: e.target.value })} aria-label="Ingredient">
                <option value="">ingredient…</option>
                {ingredients.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.unit} {x.name}
                  </option>
                ))}
              </select>
              <button type="button" className="icon-btn" onClick={() => patch(i, { items: o.items.filter((_, m) => m !== k) })} aria-label="Remove">
                <X size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="link small" onClick={() => patch(i, { items: [...o.items, { ingredient_id: '', mode: 'more', qty: '1' }] })}>
            + ingredient change
          </button>
          {o.items.some((it) => it.ingredient_id) && (
            <small className="muted">
              {o.items
                .filter((it) => it.ingredient_id && Number(it.qty) > 0)
                .map((it) => `${it.mode === 'less' ? '−' : '+'}${it.qty} ${ingById.get(it.ingredient_id)?.unit ?? ''} ${ingById.get(it.ingredient_id)?.name ?? ''}`)
                .join(' · ')}
            </small>
          )}
        </div>
      ))}
      <div className="recipe-foot">
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpts((o) => [...o, { id: newId(), name: '', price: '0', items: [{ ingredient_id: '', mode: 'more', qty: '1' }] }])}>
          + Add-on / option
        </button>
      </div>
    </div>
  );
}

/* ---------- combo meals ---------- */

function ComboBuilder({
  combo,
  setCombo,
  sellables,
  sellById,
  cost,
  regular,
  price,
}: {
  combo: { component_id: string; qty: string }[];
  setCombo: (fn: (c: { component_id: string; qty: string }[]) => { component_id: string; qty: string }[]) => void;
  sellables: Product[];
  sellById: Map<string, Product>;
  cost: number;
  regular: number;
  price: number;
}) {
  const used = new Set(combo.map((c) => c.component_id));
  const update = (i: number, p: Partial<{ component_id: string; qty: string }>) => setCombo((c) => c.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="recipe-box reveal">
      <div className="recipe-head">
        <span>
          <Layers size={15} /> <b>What's inside</b> <span className="muted">— one combo uses all of these</span>
        </span>
        {regular > 0 && price > 0 && regular > price && <span className="recipe-make">Customer saves {fmtMoney(regular - price)}</span>}
      </div>
      {sellables.length === 0 ? (
        <p className="muted small">Add the items and menu items first, then group them into a combo.</p>
      ) : (
        <>
          {combo.map((l, i) => {
            const p = sellById.get(l.component_id);
            return (
              <div key={i} className="recipe-line">
                <select className="input" value={l.component_id} onChange={(e) => update(i, { component_id: e.target.value })} aria-label="Item">
                  <option value="">Choose item…</option>
                  {sellables
                    .filter((x) => x.id === l.component_id || !used.has(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} — {fmtMoney(x.price)}
                        {x.kind === 'menu' ? ' (menu)' : ''}
                      </option>
                    ))}
                </select>
                <div className="recipe-qty">
                  <input className="input" type="number" min="1" step="1" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} aria-label="How many" />
                  <span className="muted">×</span>
                </div>
                <span className="recipe-cost">{p ? fmtMoney(p.price * (Math.trunc(Number(l.qty)) || 0)) : '—'}</span>
                <button type="button" className="icon-btn danger" onClick={() => setCombo((c) => c.filter((_, j) => j !== i))} aria-label="Remove">
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
          <div className="recipe-foot">
            <button type="button" className="btn btn-ghost btn-xs" disabled={used.size >= sellables.length} onClick={() => setCombo((c) => [...c, { component_id: '', qty: '1' }])}>
              + Add item
            </button>
            <span>
              Bought separately: <b>{fmtMoney(regular)}</b> · cost <b>{fmtMoney(cost)}</b>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
