import { useEffect, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import Modal from './Modal';
import { fmtMoney } from '../lib/format';
import type { CartOption, MenuOption, Product } from '../lib/types';

/** Register: choose add-ons / options for a menu item. Enter = add. */
export default function OptionPicker({
  product,
  qty: initialQty,
  options,
  onAdd,
  onClose,
}: {
  product: Product;
  qty: number;
  options: MenuOption[];
  onAdd: (qty: number, options: CartOption[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState(initialQty);

  const chosen = options.filter((o) => picked.includes(o.id)).map((o) => ({ id: o.id, name: o.name, price_delta: o.price_delta }));
  const each = Math.max(0, product.price + chosen.reduce((s, o) => s + o.price_delta, 0));
  const submit = () => onAdd(qty, chosen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      subtitle="Choose add-ons, or add it as is."
      footer={
        <>
          <div className="qty opt-qty">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">
              <Minus size={13} />
            </button>
            <input value={qty} inputMode="numeric" onChange={(e) => setQty(Math.max(1, Math.trunc(Number(e.target.value)) || 1))} aria-label="Quantity" />
            <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="More">
              <Plus size={13} />
            </button>
          </div>
          <button className="btn btn-primary" onClick={submit} autoFocus>
            Add {qty > 1 ? `${qty} × ` : ''}· {fmtMoney(each * qty)}
          </button>
        </>
      }
    >
      <div className="opt-grid">
        {options.map((o) => {
          const on = picked.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`opt-card ${on ? 'on' : ''}`}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== o.id) : [...p, o.id]))}
              aria-pressed={on}
            >
              <span className="opt-tick">{on && <Check size={14} />}</span>
              <span className="grow">{o.name}</span>
              <small>{o.price_delta > 0 ? `+${fmtMoney(o.price_delta)}` : o.price_delta < 0 ? `−${fmtMoney(-o.price_delta)}` : 'free'}</small>
            </button>
          );
        })}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        {fmtMoney(product.price)} base{chosen.length ? ` · with ${chosen.map((o) => o.name).join(', ')}` : ''} → <b>{fmtMoney(each)}</b> each
      </p>
    </Modal>
  );
}
