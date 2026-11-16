import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import Modal from './Modal';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import type { Product } from '../lib/types';

interface Props {
  product: Product | null;
  onClose: () => void;
  onSaved: (id: string, newStock: number) => void;
}

export default function StockAdjust({ product, onClose, onSaved }: Props) {
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState<'restock' | 'adjustment'>('restock');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDir('in');
    setQty(1);
    setReason('restock');
    setNote('');
  }, [product]);

  if (!product) return null;
  const change = dir === 'in' ? qty : -qty;
  const after = product.stock + change;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!qty || qty < 1) return;
    const ok = await confirmAction({
      title: 'Update stock?',
      html: `<b>${product.name}</b><br/>${product.stock} → <b>${after}</b> ${product.unit}`,
      confirmText: 'Update stock',
      danger: dir === 'out',
    });
    if (!ok) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('adjust_stock', {
      p_product_id: product.id,
      p_change: change,
      p_reason: dir === 'out' ? 'adjustment' : reason,
      p_note: note || null,
    });
    setBusy(false);
    if (error) return failure('Could not update stock', errorMessage(error));
    onSaved(product.id, data as number);
    onClose();
    success('Stock updated', `${product.name}: ${data} ${product.unit}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Adjust stock"
      subtitle={product.name}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button form="stock-form" className="btn btn-primary" disabled={busy || after < 0}>
            {busy && <Loader2 size={15} className="spin" />} Save
          </button>
        </>
      }
    >
      <form id="stock-form" onSubmit={submit} className="stack">
        <div className="seg seg-wide">
          <button type="button" className={dir === 'in' ? 'on' : ''} onClick={() => setDir('in')}>
            <Plus size={15} /> Add stock
          </button>
          <button type="button" className={dir === 'out' ? 'on' : ''} onClick={() => setDir('out')}>
            <Minus size={15} /> Remove
          </button>
          <i className={`seg-pill ${dir === 'out' ? 'right' : ''}`} />
        </div>

        <div className="stock-dial">
          <button type="button" className="icon-btn lg" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            <Minus size={18} />
          </button>
          <input className="input dial-input" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} />
          <button type="button" className="icon-btn lg" onClick={() => setQty((q) => q + 1)}>
            <Plus size={18} />
          </button>
        </div>
        <p className="center muted">
          {product.stock} → <b className={after < 0 ? 'neg' : ''}>{after}</b> {product.unit}
        </p>

        {dir === 'in' && (
          <label className="field">
            <span>Reason</span>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value as 'restock' | 'adjustment')}>
              <option value="restock">Restock / delivery</option>
              <option value="adjustment">Count correction</option>
            </select>
          </label>
        )}
        <label className="field">
          <span>Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={dir === 'out' ? 'Damaged, expired, lost…' : 'Supplier, invoice no…'} />
        </label>
      </form>
    </Modal>
  );
}
