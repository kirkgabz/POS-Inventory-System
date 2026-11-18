import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Camera,
  CameraOff,
  Landmark,
  Loader2,
  Minus,
  Plus,
  Printer,
  QrCode,
  ScanLine,
  ShoppingBag,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useProducts } from '../hooks/useProducts';
import { useRecipes } from '../hooks/useRecipes';
import { canMake, isIngredient, isMenu, shortfalls } from '../lib/recipes';
import { usePaymentAccounts } from '../hooks/usePaymentAccounts';
import CameraScanner, { beep } from '../components/CameraScanner';
import ProductForm from '../components/ProductForm';
import PaymentAccountCard, { kindIcon, maskNumber } from '../components/PaymentAccountCard';
import Modal from '../components/Modal';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, toast } from '../lib/alerts';
import { normaliseCode } from '../lib/codes';
import { fmtMoney, methodLabel } from '../lib/format';
import { printReceipt } from '../lib/receipt';
import type { CartLine, PaymentAccount, Product, SaleResult } from '../lib/types';

const CART_KEY = 'jen-pos-cart';
type Method = 'cash' | 'ewallet' | 'bank';
type Receipt = SaleResult & { lines: CartLine[]; at: string; method: Method; account?: string; ref?: string };

export default function PosPage() {
  const { profile, canManageProducts } = useAuth();
  const { products: catalogue, categories, findByCode: findAny, upsertLocal } = useProducts();
  const { byMenu } = useRecipes();
  // ingredients are never sold at the register
  const products = useMemo(() => catalogue.filter((p) => !isIngredient(p)), [catalogue]);
  const byId = useMemo(() => new Map(catalogue.map((p) => [p.id, p])), [catalogue]);
  const findByCode = (code: string) => {
    const p = findAny(code);
    if (p && isIngredient(p)) {
      toast(`${p.name} is an ingredient — it isn't sold at the register`, 'info');
      return null;
    }
    return p;
  };
  /** what a line can still go up to: items = stock, menu items = no hard limit */
  const makeable = (p: Product) => (isMenu(p) ? canMake(byMenu.get(p.id), byId) : p.stock);
  /** ingredients already needed by the menu items in the order (optionally skipping one line) */
  const reservedBy = (lines: CartLine[], skip?: string) => {
    const m = new Map<string, number>();
    lines.forEach((l) => {
      if (l.product.id === skip || !isMenu(l.product)) return;
      byMenu.get(l.product.id)?.forEach((r) => m.set(r.ingredient_id, (m.get(r.ingredient_id) ?? 0) + r.qty * l.quantity));
    });
    return m;
  };
  /** warn-but-allow: which ingredients would run short for this many servings */
  const shortText = (p: Product, servings: number, lines: CartLine[]) => {
    const recipe = byMenu.get(p.id);
    if (!recipe?.length) return `${p.name} has no recipe yet — no ingredients will be deducted`;
    const short = shortfalls(recipe, byId, servings, reservedBy(lines, p.id));
    return short.length ? `Low on ${short.map((x) => x.ingredient.name).join(', ')} — added anyway, the owner will be told` : null;
  };
  const { accounts } = usePaymentAccounts();

  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [query, setQuery] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [hi, setHi] = useState(0);
  const [sugOpen, setSugOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [discount, setDiscount] = useState<number>(0);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [account, setAccount] = useState<PaymentAccount | null>(null);
  const [showAccount, setShowAccount] = useState<PaymentAccount | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  // keep cart prices/stock in sync with the live catalogue
  useEffect(() => {
    if (!products.length) return;
    setCart((c) =>
      c
        .filter((l) => products.some((p) => p.id === l.product.id))
        .map((l) => ({ ...l, product: products.find((p) => p.id === l.product.id)! })),
    );
  }, [products]);

  /* ---------- payment accounts ---------- */
  const byKind = useMemo(
    () => ({ ewallet: accounts.filter((a) => a.kind === 'ewallet'), bank: accounts.filter((a) => a.kind === 'bank') }),
    [accounts],
  );
  const available = (m: Method) => m === 'cash' || byKind[m].length > 0;

  useEffect(() => {
    if (method === 'cash') return setAccount(null);
    if (!available(method)) {
      setMethod('cash');
      return;
    }
    setAccount((cur) => (cur && byKind[method].some((a) => a.id === cur.id) ? cur : byKind[method].length === 1 ? byKind[method][0]! : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, byKind]);

  /* ---------- totals ---------- */
  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.product.price * l.quantity, 0), [cart]);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - disc;
  const paidNum = method === 'cash' ? Number(paid) || 0 : total;
  const change = paidNum - total;
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  /* ---------- cart ops ---------- */
  /** returns false (not added), true (added) or a warning string (added, but ingredients are short) */
  const add = (p: Product, qty = 1): boolean | string => {
    const inCart = cart.find((l) => l.product.id === p.id)?.quantity ?? 0;
    if (isMenu(p)) {
      const warn = shortText(p, inCart + qty, cart);
      setCart((c) => {
        const i = c.findIndex((l) => l.product.id === p.id);
        if (i === -1) return [...c, { product: p, quantity: qty }];
        const next = c.slice();
        next[i] = { ...next[i]!, quantity: next[i]!.quantity + qty };
        return next;
      });
      setFlash(p.id);
      setTimeout(() => setFlash(null), 600);
      return warn ?? true;
    }
    const room = p.stock - inCart;
    if (room <= 0) {
      beep(false);
      toast(p.stock <= 0 ? `${p.name} is out of stock` : `All ${p.stock} ${p.unit} of ${p.name} are already in the order`, 'warning');
      return false;
    }
    const q = Math.min(qty, room);
    if (q < qty) toast(`Only ${p.stock} ${p.unit} in stock — added ${q}`, 'warning');
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i === -1) return [...c, { product: p, quantity: q }];
      const next = c.slice();
      next[i] = { ...next[i]!, quantity: next[i]!.quantity + q };
      return next;
    });
    setFlash(p.id);
    setTimeout(() => setFlash(null), 600);
    return true;
  };

  const setQty = (id: string, qty: number) =>
    setCart((c) =>
      c.map((l) => {
        if (l.product.id !== id) return l;
        const q = Math.max(1, Math.trunc(qty) || 1);
        if (isMenu(l.product)) {
          if (q > l.quantity) {
            const warn = shortText(l.product, q, c);
            if (warn) toast(warn, 'warning');
          }
          return { ...l, quantity: q };
        }
        if (q > l.product.stock) {
          toast(`Only ${l.product.stock} ${l.product.unit} in stock`, 'warning');
          return { ...l, quantity: l.product.stock };
        }
        return { ...l, quantity: q };
      }),
    );

  const removeLine = async (l: CartLine) => {
    if (await confirmAction({ title: 'Remove from order?', html: `<b>${esc(l.product.name)}</b> × ${l.quantity}`, confirmText: 'Remove', danger: true })) {
      setCart((c) => c.filter((x) => x.product.id !== l.product.id));
      toast('Removed', 'info');
    }
  };

  const pick = (p: Product) => {
    if (!isMenu(p) && p.stock <= 0) return toast(`${p.name} is out of stock`, 'warning');
    const res = add(p, addQty);
    if (res) {
      beep();
      if (typeof res === 'string') toast(`Added ${addQty > 1 ? `${addQty} × ` : ''}${p.name}. ${res}`, 'warning');
      else toast(`Added ${addQty > 1 ? `${addQty} × ` : ''}${p.name}`);
    }
    setQuery('');
    setAddQty(1);
    setSugOpen(false);
    searchRef.current?.focus();
  };

  const handleCode = async (raw: string) => {
    const code = normaliseCode(raw);
    if (!code) return;
    const p = findByCode(code);
    if (p) return pick(p);
    beep(false);
    if (canManageProducts) {
      const ok = await confirmAction({
        title: 'Code not found',
        html: `<span class="mono">${esc(code)}</span> isn't in your inventory yet.<br/>Add it as a new product?`,
        confirmText: 'Add product',
        icon: 'info',
      });
      if (ok) setNewCode(code);
    } else {
      toast(`No product with code ${code}`, 'error');
    }
  };

  /* ---------- search suggestions (2+ characters) ---------- */
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const score = (p: Product) => {
      const wc = p.word_code?.toLowerCase() ?? '';
      const nm = p.name.toLowerCase();
      const bc = p.barcode?.toLowerCase() ?? '';
      if (wc === q || bc === q) return 0;
      if (wc.startsWith(q) || wc.split('-').some((part) => part.startsWith(q))) return 1;
      if (nm.startsWith(q)) return 2;
      if (nm.split(/\s+/).some((w) => w.startsWith(q))) return 3;
      if (wc.includes(q) || nm.includes(q)) return 4;
      if (bc.includes(q)) return 5;
      return 99;
    };
    return products
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s < 99)
      .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name))
      .slice(0, 8)
      .map((x) => x.p);
  }, [query, products]);

  useEffect(() => setHi(0), [query]);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSugOpen(true);
      setHi((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Escape') {
      setSugOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      const exact = findByCode(q);
      if (exact) return pick(exact); // USB scanner / full code typed
      if (suggestions[hi]) return pick(suggestions[hi]!);
      if (/^[A-Z0-9-]{6,}$/i.test(q)) {
        handleCode(q);
        setQuery('');
      }
    }
  };

  /* ---------- checkout ---------- */
  const clearCart = async () => {
    if (!cart.length) return;
    if (await confirmAction({ title: 'Clear the order?', text: `${itemCount} item(s) will be removed.`, confirmText: 'Clear order', danger: true })) {
      resetOrder();
      toast('Order cleared', 'info');
    }
  };

  const resetOrder = () => {
    setCart([]);
    setDiscount(0);
    setPaid('');
    setRef('');
    setMethod('cash');
  };

  const checkout = async () => {
    if (!cart.length) return;
    if (method === 'cash' && change < 0) return failure('Not enough cash', `Customer still owes ${fmtMoney(-change)}.`);
    if (method !== 'cash' && !account) return failure('Choose an account', `Select which ${methodLabel(method)} account the customer paid to.`);

    const acctLabel = account ? `${account.provider} · ${account.account_name}` : '';
    const ok = await confirmAction({
      title: 'Complete this sale?',
      html: `<div class="sw-summary"><span>${itemCount} item(s)</span><b>${fmtMoney(total)}</b></div>
        ${
          method === 'cash'
            ? `<div class="sw-summary"><span>Cash</span><span>${fmtMoney(paidNum)}</span></div><div class="sw-summary big"><span>Change</span><b>${fmtMoney(change)}</b></div>`
            : `<div class="sw-summary"><span>${methodLabel(method)}</span><span>${esc(acctLabel)}</span></div><div class="sw-summary"><span>Reference</span><span class="mono">${ref ? esc(ref) : '—'}</span></div>`
        }`,
      confirmText: 'Complete sale',
    });
    if (!ok) return;

    setBusy(true);
    const { data, error } = await supabase.rpc('process_sale', {
      p_items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
      p_amount_paid: paidNum,
      p_payment_method: method,
      p_discount: disc,
      p_payment_account: acctLabel || null,
      p_payment_ref: method === 'cash' ? null : ref.trim() || null,
    });
    setBusy(false);
    if (error) return failure('Sale not completed', errorMessage(error));

    const res = data as SaleResult;
    setReceipt({ ...res, lines: cart, at: new Date().toISOString(), method, account: acctLabel || undefined, ref: ref.trim() || undefined });
    cart.forEach((l) => !isMenu(l.product) && upsertLocal({ ...l.product, stock: l.product.stock - l.quantity }));
    resetOrder();
    beep();
    if (res.short?.length) {
      const names = [...new Set(res.short.map((x) => x.ingredient))].join(', ');
      setTimeout(() => toast(`Sale saved. Short on ${names} — please count and restock.`, 'warning'), 400);
    }
  };

  const quickCash = useMemo(() => {
    if (total <= 0) return [];
    const opts = new Set<number>([Math.ceil(total)]);
    [20, 50, 100, 200, 500, 1000].forEach((b) => opts.add(Math.ceil(total / b) * b));
    return [...opts].sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  const methods: { key: Method; label: string; icon: ReactNode }[] = [
    { key: 'cash', label: 'Cash', icon: null },
    { key: 'ewallet', label: 'E-wallet', icon: <Wallet size={14} /> },
    { key: 'bank', label: 'Bank / Card', icon: <Landmark size={14} /> },
  ];

  return (
    <div className="pos">
      <section className="pos-left">
        <header className="page-head tight">
          <div>
            <span className="eyebrow">Register · {profile?.full_name}</span>
            <h1 className="display">Point of Sale</h1>
          </div>
          <button className={`btn ${camera ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCamera((c) => !c)}>
            {camera ? <CameraOff size={16} /> : <Camera size={16} />}
            {camera ? 'Stop camera' : 'Scan with camera'}
          </button>
        </header>

        {camera && (
          <div className="pos-camera reveal">
            <CameraScanner onScan={handleCode} />
            <p className="muted small center">Point at a barcode, QR or word-code label. Items are added automatically.</p>
          </div>
        )}

        <div className="add-row">
          <div className="search search-lg suggest-wrap">
            <ScanLine size={18} />
            <input
              ref={searchRef}
              className="input"
              autoFocus
              placeholder="Type a word code or name (2+ letters), or scan…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSugOpen(true);
              }}
              onFocus={() => setSugOpen(true)}
              onBlur={() => setTimeout(() => setSugOpen(false), 150)}
              onKeyDown={onSearchKey}
              role="combobox"
              aria-expanded={sugOpen && suggestions.length > 0}
            />
            {query && (
              <button className="input-icon" onClick={() => setQuery('')} aria-label="Clear">
                <X size={16} />
              </button>
            )}

            {sugOpen && query.trim().length >= 2 && (
              <div className="suggest" role="listbox">
                {suggestions.length === 0 ? (
                  <div className="suggest-empty muted small">No product matches “{query.trim()}”.</div>
                ) : (
                  suggestions.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={i === hi}
                      className={`suggest-item ${i === hi ? 'hi' : ''} ${!isMenu(p) && p.stock <= 0 ? 'out' : ''}`}
                      onMouseEnter={() => setHi(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(p);
                      }}
                    >
                      <span className={`prod-dot ${p.image_url ? 'has-img' : ''}`} data-letter={p.name[0]}>
                        {p.image_url && <img src={p.image_url} alt="" />}
                      </span>
                      <span className="grow">
                        <strong>
                          <Mark text={p.name} q={query} />
                        </strong>
                        <span className="mono small muted">
                          <Mark text={p.word_code ?? p.barcode ?? ''} q={query} />
                        </span>
                      </span>
                      <span className="suggest-right">
                        <b>{fmtMoney(p.price)}</b>
                        {isMenu(p) ? (
                          (() => {
                            const n = makeable(p);
                            return (
                              <small className={n !== null && n <= p.low_stock_threshold ? 'warn' : 'muted'}>
                                {n === null ? 'made to order' : n <= 0 ? 'ingredients low' : `can make ${n}`}
                              </small>
                            );
                          })()
                        ) : (
                          <small className={p.stock <= p.low_stock_threshold ? 'warn' : 'muted'}>
                            {p.stock <= 0 ? 'sold out' : `${p.stock} left`}
                          </small>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="qty qty-lg" title="Quantity to add">
            <button onClick={() => setAddQty((q) => Math.max(1, q - 1))} aria-label="Less">
              <Minus size={14} />
            </button>
            <input value={addQty} inputMode="numeric" onChange={(e) => setAddQty(Math.max(1, Math.trunc(Number(e.target.value)) || 1))} aria-label="Quantity" />
            <button onClick={() => setAddQty((q) => q + 1)} aria-label="More">
              <Plus size={14} />
            </button>
          </div>
        </div>

        <section className="order card">
          <header className="card-head">
            <div>
              <span className="eyebrow">Current order</span>
              <h3 className="display">
                {itemCount} item{itemCount === 1 ? '' : 's'} <span className="muted">· {cart.length} product{cart.length === 1 ? '' : 's'}</span>
              </h3>
            </div>
            {cart.length > 0 && (
              <button className="btn btn-ghost btn-xs" onClick={clearCart}>
                <Trash2 size={13} /> Clear
              </button>
            )}
          </header>

          {cart.length === 0 ? (
            <div className="empty">
              <ShoppingBag size={36} strokeWidth={1.1} />
              <p>Scan a barcode or type a word code above to start the order.</p>
            </div>
          ) : (
            <div className="order-lines">
              <div className="order-row order-headrow">
                <span>#</span>
                <span>Product</span>
                <span className="num">Price</span>
                <span className="center">Qty</span>
                <span className="num">Amount</span>
                <span />
              </div>
              {cart.map((l, i) => (
                <div key={l.product.id} className={`order-row row-in ${flash === l.product.id ? 'flash' : ''}`}>
                  <span className="muted">{i + 1}</span>
                  <span className="ol-name">
                    <strong>{l.product.name}</strong>
                    <span className="mono small muted">
                      {l.product.word_code ?? l.product.barcode} ·{' '}
                      {isMenu(l.product)
                        ? (() => {
                            const n = makeable(l.product);
                            return n === null ? 'made to order' : `can make ${n}`;
                          })()
                        : `${l.product.stock} in stock`}
                    </span>
                  </span>
                  <span className="num">{fmtMoney(l.product.price)}</span>
                  <span className="center">
                    <span className="qty">
                      <button onClick={() => (l.quantity <= 1 ? removeLine(l) : setQty(l.product.id, l.quantity - 1))} aria-label="Less">
                        <Minus size={13} />
                      </button>
                      <input value={l.quantity} inputMode="numeric" onChange={(e) => setQty(l.product.id, Number(e.target.value))} />
                      <button onClick={() => setQty(l.product.id, l.quantity + 1)} disabled={!isMenu(l.product) && l.quantity >= l.product.stock} aria-label="More">
                        <Plus size={13} />
                      </button>
                    </span>
                  </span>
                  <b className="num">{fmtMoney(l.product.price * l.quantity)}</b>
                  <button className="icon-btn danger" onClick={() => removeLine(l)} aria-label="Remove">
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      <aside className="pos-cart">
        <header className="cart-head">
          <h2 className="display">
            Payment <em>{itemCount}</em>
          </h2>
        </header>

        <div className="cart-summary">
          <div className="sum-row">
            <span>Subtotal</span>
            <span>{fmtMoney(subtotal)}</span>
          </div>
          <div className="sum-row">
            <span>Discount</span>
            <input className="input input-inline" type="number" min={0} step="0.01" value={discount || ''} placeholder="0.00" onChange={(e) => setDiscount(Number(e.target.value))} />
          </div>
          <div className="sum-row total">
            <span>Total</span>
            <b className="display">{fmtMoney(total)}</b>
          </div>

          <div className="methods">
            {methods.map((m) => {
              const ok = available(m.key);
              return (
                <button
                  key={m.key}
                  className={`method ${method === m.key ? 'on' : ''}`}
                  disabled={!ok}
                  onClick={() => setMethod(m.key)}
                  title={ok ? m.label : `${m.label} unavailable — no account added yet`}
                >
                  <span className="method-top">
                    {m.icon} {m.label}
                  </span>
                  {!ok && <small>Unavailable</small>}
                </button>
              );
            })}
          </div>

          {method === 'cash' ? (
            <>
              <div className="sum-row">
                <span>Cash received</span>
                <input className="input input-inline" type="number" min={0} step="0.01" value={paid} placeholder="0.00" onChange={(e) => setPaid(e.target.value)} />
              </div>
              <div className="quick-cash">
                {quickCash.map((v) => (
                  <button key={v} className="chip-btn" onClick={() => setPaid(String(v))}>
                    {fmtMoney(v)}
                  </button>
                ))}
              </div>
              <div className={`sum-row change ${change < 0 && paid ? 'neg' : ''}`}>
                <span>Change</span>
                <b>{paid ? fmtMoney(change) : '—'}</b>
              </div>
            </>
          ) : (
            <div className="acct-pick reveal">
              <span className="eyebrow">Pay to</span>
              {byKind[method].map((a) => (
                <div key={a.id} className={`acct-opt ${account?.id === a.id ? 'on' : ''}`} onClick={() => setAccount(a)}>
                  <span className="acct-ico">{kindIcon(a.kind, 16, a.provider)}</span>
                  <span className="grow">
                    <strong>{a.provider}</strong>
                    <span className="muted small">
                      {a.account_name} · <span className="mono">{maskNumber(a.account_number)}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAccount(a);
                      setShowAccount(a);
                    }}
                  >
                    <QrCode size={13} /> Show
                  </button>
                </div>
              ))}
              <label className="field">
                <span>Reference no. (from customer's receipt)</span>
                <input className="input mono" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 1009 234 567" />
              </label>
            </div>
          )}

          <button className="btn btn-primary btn-block btn-lg checkout" disabled={!cart.length || busy} onClick={checkout}>
            {busy && <Loader2 size={17} className="spin" />}
            Charge {fmtMoney(total)}
          </button>
        </div>
      </aside>

      <PaymentAccountCard account={showAccount} amount={fmtMoney(total)} onClose={() => setShowAccount(null)} />

      <ProductForm
        open={!!newCode}
        initialCode={newCode ?? ''}
        onClose={() => setNewCode(null)}
        categories={categories}
        onSaved={(p) => {
          upsertLocal(p);
          if (!isIngredient(p) && (isMenu(p) || p.stock > 0)) add(p);
        }}
      />

      <Modal
        open={!!receipt}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
        title="Sale complete"
        subtitle={receipt?.receipt_no}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => receipt && printPosReceipt(receipt, profile?.full_name ?? '')}>
              <Printer size={15} /> Print receipt
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setReceipt(null);
                searchRef.current?.focus();
              }}
            >
              New sale
            </button>
          </>
        }
      >
        {receipt && (
          <div className="receipt-done">
            <div className="check-anim">
              <svg viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="24" />
                <path d="M15 27 l7 7 l15 -16" />
              </svg>
            </div>
            {receipt.method === 'cash' ? (
              <div className="change-big">
                <span className="eyebrow">Change due</span>
                <b className="display">{fmtMoney(receipt.change)}</b>
              </div>
            ) : (
              <div className="change-big">
                <span className="eyebrow">Paid via {methodLabel(receipt.method)}</span>
                <b className="display" style={{ fontSize: 28 }}>{receipt.account}</b>
                {receipt.ref && <span className="mono small muted">Ref {receipt.ref}</span>}
              </div>
            )}
            <div className="receipt-lines">
              {receipt.lines.map((l) => (
                <div key={l.product.id}>
                  <span>
                    {l.quantity} × {l.product.name}
                  </span>
                  <span>{fmtMoney(l.quantity * l.product.price)}</span>
                </div>
              ))}
              {receipt.discount > 0 && (
                <div className="muted">
                  <span>Discount</span>
                  <span>−{fmtMoney(receipt.discount)}</span>
                </div>
              )}
              <div className="strong">
                <span>Total</span>
                <span>{fmtMoney(receipt.total)}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Highlights the part of `text` that matches the query. */
function Mark({ text, q }: { text: string; q: string }) {
  const query = q.trim();
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function printPosReceipt(r: Receipt, cashier: string) {
  printReceipt({
    receipt_no: r.receipt_no,
    at: r.at,
    cashier,
    lines: r.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unit_price: l.product.price })),
    subtotal: r.subtotal,
    discount: r.discount,
    total: r.total,
    method: r.method,
    amount_paid: r.amount_paid,
    change: r.change,
    account: r.account,
    ref: r.ref,
  });
}
