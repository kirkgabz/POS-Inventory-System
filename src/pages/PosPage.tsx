import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Camera, CameraOff, Loader2, Minus, Plus, Printer, ScanLine, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useProducts } from '../hooks/useProducts';
import CameraScanner, { beep } from '../components/CameraScanner';
import ProductForm from '../components/ProductForm';
import Modal from '../components/Modal';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, toast } from '../lib/alerts';
import { normaliseCode } from '../lib/codes';
import { STORE_NAME, fmtDate, fmtMoney } from '../lib/format';
import type { CartLine, Product, SaleResult } from '../lib/types';

const CART_KEY = 'jen-pos-cart';

export default function PosPage() {
  const { profile, canManageProducts } = useAuth();
  const { products, categories, findByCode, upsertLocal } = useProducts();
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [camera, setCamera] = useState(false);
  const [discount, setDiscount] = useState<number>(0);
  const [paid, setPaid] = useState<string>('');
  const [method, setMethod] = useState<'cash' | 'gcash' | 'card'>('cash');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<(SaleResult & { lines: CartLine[]; at: string; method: string }) | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [bump, setBump] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  // keep cart prices/stock in sync with live catalogue
  useEffect(() => {
    setCart((c) =>
      c
        .map((l) => ({ ...l, product: products.find((p) => p.id === l.product.id) ?? l.product }))
        .filter((l) => products.length === 0 || products.some((p) => p.id === l.product.id)),
    );
  }, [products]);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.product.price * l.quantity, 0), [cart]);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - disc;
  const paidNum = method === 'cash' ? Number(paid) || 0 : total;
  const change = paidNum - total;
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  const add = (p: Product, qty = 1) => {
    const inCart = cart.find((l) => l.product.id === p.id)?.quantity ?? 0;
    if (inCart + qty > p.stock) {
      beep(false);
      toast(p.stock <= 0 ? `${p.name} is out of stock` : `Only ${p.stock} ${p.unit} of ${p.name} left`, 'warning');
      return;
    }
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i === -1) return [{ product: p, quantity: qty }, ...c];
      const next = c.slice();
      next[i] = { ...next[i]!, quantity: next[i]!.quantity + qty };
      return next;
    });
    setBump(p.id);
    setTimeout(() => setBump(null), 400);
  };

  const setQty = (id: string, qty: number) =>
    setCart((c) =>
      c.flatMap((l) => {
        if (l.product.id !== id) return [l];
        if (qty <= 0) return [];
        if (qty > l.product.stock) {
          toast(`Only ${l.product.stock} left`, 'warning');
          return [{ ...l, quantity: l.product.stock }];
        }
        return [{ ...l, quantity: qty }];
      }),
    );

  const handleCode = async (raw: string) => {
    const code = normaliseCode(raw);
    if (!code) return;
    const p = findByCode(code);
    if (p) {
      beep();
      add(p);
      toast(`Added ${p.name}`);
      return;
    }
    beep(false);
    if (canManageProducts) {
      const ok = await confirmAction({
        title: 'Code not found',
        html: `<span class="mono">${code}</span> isn't in your inventory yet.<br/>Add it as a new product?`,
        confirmText: 'Add product',
        icon: 'info',
      });
      if (ok) setNewCode(code);
    } else {
      toast(`No product with code ${code}`, 'error');
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!cat || p.category === cat) &&
        (!q || p.name.toLowerCase().includes(q) || p.word_code?.toLowerCase().includes(q) || p.barcode?.includes(q)),
    );
  }, [products, query, cat]);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    // USB barcode scanners type the code + Enter
    if (findByCode(q) || /^[A-Z0-9-]{6,}$/i.test(q)) {
      handleCode(q);
    } else if (filtered.length === 1) {
      add(filtered[0]!);
    } else return;
    setQuery('');
  };

  const clearCart = async () => {
    if (!cart.length) return;
    if (await confirmAction({ title: 'Clear the cart?', text: `${itemCount} item(s) will be removed.`, confirmText: 'Clear cart', danger: true })) {
      setCart([]);
      setDiscount(0);
      setPaid('');
      toast('Cart cleared', 'info');
    }
  };

  const checkout = async () => {
    if (!cart.length) return;
    if (method === 'cash' && change < 0) {
      failure('Not enough cash', `Customer still owes ${fmtMoney(-change)}.`);
      return;
    }
    const ok = await confirmAction({
      title: 'Complete this sale?',
      html: `<div class="sw-summary"><span>${itemCount} item(s)</span><b>${fmtMoney(total)}</b></div>
        ${method === 'cash' ? `<div class="sw-summary"><span>Cash</span><span>${fmtMoney(paidNum)}</span></div><div class="sw-summary big"><span>Change</span><b>${fmtMoney(change)}</b></div>` : `<div class="sw-summary"><span>Paid via</span><span>${method.toUpperCase()}</span></div>`}`,
      confirmText: 'Complete sale',
    });
    if (!ok) return;

    setBusy(true);
    const { data, error } = await supabase.rpc('process_sale', {
      p_items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
      p_amount_paid: paidNum,
      p_payment_method: method,
      p_discount: disc,
    });
    setBusy(false);
    if (error) return failure('Sale not completed', errorMessage(error));

    const res = data as SaleResult;
    setReceipt({ ...res, lines: cart, at: new Date().toISOString(), method });
    // optimistic local stock update (realtime will also confirm)
    cart.forEach((l) => upsertLocal({ ...l.product, stock: l.product.stock - l.quantity }));
    setCart([]);
    setDiscount(0);
    setPaid('');
    beep();
  };

  const quickCash = useMemo(() => {
    if (total <= 0) return [];
    const bills = [20, 50, 100, 200, 500, 1000];
    const opts = new Set<number>([Math.ceil(total)]);
    bills.forEach((b) => opts.add(Math.ceil(total / b) * b));
    return [...opts].sort((a, b) => a - b).slice(0, 4);
  }, [total]);

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

        <div className="search search-lg">
          <ScanLine size={18} />
          <input
            ref={searchRef}
            className="input"
            autoFocus
            placeholder="Scan with USB scanner, type a code, or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {query && (
            <button className="input-icon" onClick={() => setQuery('')} aria-label="Clear">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="chips">
          <button className={`chip-btn ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} className={`chip-btn ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>

        <div className="tiles">
          {filtered.slice(0, 120).map((p) => (
            <button
              key={p.id}
              className={`tile ${p.stock <= 0 ? 'disabled' : ''} ${bump === p.id ? 'bump' : ''}`}
              onClick={() => add(p)}
              disabled={p.stock <= 0}
            >
              {p.image_url ? (
                <span className="tile-photo">
                  <img className="tile-img" src={p.image_url} alt="" loading="lazy" />
                </span>
              ) : (
                <span className="tile-letter display">{p.name[0]}</span>
              )}
              <span className="tile-name">{p.name}</span>
              <span className="tile-foot">
                <b>{fmtMoney(p.price)}</b>
                <small className={p.stock <= p.low_stock_threshold ? 'warn' : ''}>
                  {p.stock <= 0 ? 'sold out' : `${p.stock} left`}
                </small>
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="empty wide">
              <Search size={30} strokeWidth={1.2} />
              <p>No matching products.</p>
            </div>
          )}
        </div>
      </section>

      <aside className="pos-cart">
        <header className="cart-head">
          <h2 className="display">
            Order <em>{itemCount}</em>
          </h2>
          {cart.length > 0 && (
            <button className="btn btn-ghost btn-xs" onClick={clearCart}>
              <Trash2 size={13} /> Clear
            </button>
          )}
        </header>

        <div className="cart-lines">
          {cart.length === 0 ? (
            <div className="empty cart-empty">
              <ShoppingBag size={34} strokeWidth={1.1} />
              <p>Scan or tap a product to begin.</p>
            </div>
          ) : (
            cart.map((l) => (
              <div key={l.product.id} className={`cart-line ${bump === l.product.id ? 'flash' : ''}`}>
                <div className="cl-info">
                  <strong>{l.product.name}</strong>
                  <span className="muted small">{fmtMoney(l.product.price)} / {l.product.unit}</span>
                </div>
                <div className="qty">
                  <button onClick={() => setQty(l.product.id, l.quantity - 1)} aria-label="Less">
                    <Minus size={13} />
                  </button>
                  <input
                    value={l.quantity}
                    inputMode="numeric"
                    onChange={(e) => setQty(l.product.id, Math.trunc(Number(e.target.value) || 0))}
                  />
                  <button onClick={() => setQty(l.product.id, l.quantity + 1)} aria-label="More">
                    <Plus size={13} />
                  </button>
                </div>
                <b className="cl-total">{fmtMoney(l.product.price * l.quantity)}</b>
              </div>
            ))
          )}
        </div>

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

          <div className="seg seg-3">
            {(['cash', 'gcash', 'card'] as const).map((m) => (
              <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
                {m === 'gcash' ? 'E-wallet' : m[0]!.toUpperCase() + m.slice(1)}
              </button>
            ))}
            <i className="seg-pill" style={{ transform: `translateX(${['cash', 'gcash', 'card'].indexOf(method) * 100}%)` }} />
          </div>

          {method === 'cash' && (
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
          )}

          <button className="btn btn-primary btn-block btn-lg checkout" disabled={!cart.length || busy} onClick={checkout}>
            {busy ? <Loader2 size={17} className="spin" /> : null}
            Charge {fmtMoney(total)}
          </button>
        </div>
      </aside>

      <ProductForm
        open={!!newCode}
        initialCode={newCode ?? ''}
        onClose={() => setNewCode(null)}
        categories={categories}
        onSaved={(p) => {
          upsertLocal(p);
          if (p.stock > 0) add(p);
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
            <button className="btn btn-ghost" onClick={() => receipt && printReceipt(receipt, profile?.full_name ?? '')}>
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
            {receipt.method === 'cash' && (
              <div className="change-big">
                <span className="eyebrow">Change due</span>
                <b className="display">{fmtMoney(receipt.change)}</b>
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

function printReceipt(r: SaleResult & { lines: CartLine[]; at: string; method: string }, cashier: string) {
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  w.document.write(`<!doctype html><html><head><title>${r.receipt_no}</title><style>
    @page { size: 58mm auto; margin: 2mm; }
    body { font: 10pt 'DM Mono', ui-monospace, monospace; width: 54mm; margin: 0 auto; color: #000; }
    h1 { font: 600 13pt Georgia, serif; text-align: center; margin: 2mm 0 0; }
    .c { text-align: center; } .r { display: flex; justify-content: space-between; gap: 2mm; }
    hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; } .b { font-weight: 700; font-size: 11pt; }
  </style></head><body>
    <h1>${esc(STORE_NAME)}</h1>
    <div class="c">${esc(fmtDate(r.at))}<br/>${esc(r.receipt_no)} · ${esc(cashier)}</div><hr/>
    ${r.lines.map((l) => `<div>${esc(l.product.name)}</div><div class="r"><span>${l.quantity} × ${esc(fmtMoney(l.product.price))}</span><span>${esc(fmtMoney(l.quantity * l.product.price))}</span></div>`).join('')}
    <hr/><div class="r"><span>Subtotal</span><span>${esc(fmtMoney(r.subtotal))}</span></div>
    ${r.discount > 0 ? `<div class="r"><span>Discount</span><span>-${esc(fmtMoney(r.discount))}</span></div>` : ''}
    <div class="r b"><span>TOTAL</span><span>${esc(fmtMoney(r.total))}</span></div>
    <div class="r"><span>${esc(r.method.toUpperCase())}</span><span>${esc(fmtMoney(r.amount_paid))}</span></div>
    <div class="r"><span>Change</span><span>${esc(fmtMoney(r.change))}</span></div>
    <hr/><div class="c">Thank you, come again!</div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}<\/script>
  </body></html>`);
  w.document.close();
}
