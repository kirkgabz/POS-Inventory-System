import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Minus, Package, Plus } from 'lucide-react';
import Modal from './Modal';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { fmtMoney } from '../lib/format';
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
  // why stock is being removed — spoiled/damaged count as waste
  const [why, setWhy] = useState<keyof typeof WHY>('spoiled');
  const [busy, setBusy] = useState(false);
  // receive by pack: packs × pieces per pack, optionally with the new pack price
  const [byPack, setByPack] = useState(false);
  const [packSize, setPackSize] = useState('12');
  const [packPrice, setPackPrice] = useState('');

  useEffect(() => {
    setDir('in');
    setQty(1);
    setReason('restock');
    setNote('');
    setWhy('spoiled');
    const size = product?.pack_size ?? null;
    setByPack(!!size);
    setPackSize(String(size ?? 12));
    setPackPrice('');
  }, [product]);

  if (!product) return null;
  const size = Math.trunc(Number(packSize) || 0);
  const packing = dir === 'in' && byPack;
  const pieces = packing ? qty * size : qty;
  const change = dir === 'in' ? pieces : -pieces;
  const after = product.stock + change;
  const newPackPrice = Number(packPrice) || 0;
  const newUnitCost = packing && newPackPrice > 0 && size >= 2 ? Math.round((newPackPrice / size) * 10000) / 10000 : null;
  const costChanges = newUnitCost !== null && Math.abs(newUnitCost - Number(product.cost)) >= 0.005;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!qty || qty < 1) return;
    if (packing && size < 2) return failure('Pieces per pack', 'A pack should have 2 or more pieces.');
    const ok = await confirmAction({
      title: dir === 'out' && WHY[why].reason === 'waste' ? 'Record as waste?' : 'Update stock?',
      html:
        `<b>${esc(product.name)}</b><br/>` +
        (packing ? `${qty} pack(s) × ${size} = <b>${pieces}</b> ${esc(product.unit)}<br/>` : '') +
        `${product.stock} → <b>${after}</b> ${esc(product.unit)}` +
        (dir === 'out' ? `<br/><span class="muted">${WHY[why].label}${Number(product.cost) > 0 ? ` · ${fmtMoney(Number(product.cost) * qty)}` : ''}</span>` : '') +
        (costChanges
          ? `<br/><span class="muted">Cost per ${esc(product.unit)}: ${fmtMoney(product.cost)} → <b>${fmtMoney(newUnitCost!)}</b></span>` +
            (Number(product.price) < newUnitCost!
              ? `<br/><b style="color:var(--danger)">The selling price ${fmtMoney(product.price)} is now below cost.</b>`
              : '')
          : ''),
      confirmText: 'Update stock',
      danger: dir === 'out',
    });
    if (!ok) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('adjust_stock', {
      p_product_id: product.id,
      p_change: change,
      p_reason: dir === 'out' ? WHY[why].reason : reason,
      p_note:
        dir === 'out'
          ? `${WHY[why].label}${note ? ` · ${note}` : ''}`
          : (packing ? `${qty} pack(s) × ${size}${newPackPrice ? ` @ ${fmtMoney(newPackPrice)}` : ''}` + (note ? ' · ' : '') : '') + note || null,
    });
    if (error) {
      setBusy(false);
      return failure('Could not update stock', errorMessage(error));
    }

    // remember the pack size / new cost on the product
    let costNote = '';
    if (packing && (costChanges || product.pack_size !== size)) {
      const patch: Record<string, number> = { pack_size: size };
      if (costChanges) patch.cost = newUnitCost!;
      const { error: upErr } = await supabase.from('products').update(patch).eq('id', product.id);
      if (upErr && costChanges) costNote = ' (cost not updated — ' + errorMessage(upErr) + ')';
      else if (!upErr && costChanges) costNote = ` · cost ${fmtMoney(newUnitCost!)}`;
    }
    setBusy(false);
    onSaved(product.id, data as number);
    onClose();
    success('Stock updated', `${product.name}: ${data} ${product.unit}${costNote}`);
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

        {dir === 'in' && (
          <div className="center">
            <span className="mini-seg" role="group" aria-label="Count by">
              <button type="button" className={!byPack ? 'on' : ''} onClick={() => setByPack(false)}>
                By {product.unit}
              </button>
              <button type="button" className={byPack ? 'on' : ''} onClick={() => setByPack(true)}>
                <Package size={12} /> By pack
              </button>
            </span>
          </div>
        )}

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
          {packing && (
            <>
              {qty} pack(s) × {size || '?'} = <b>{pieces}</b> {product.unit}
              <br />
            </>
          )}
          {product.stock} → <b className={after < 0 ? 'neg' : ''}>{after}</b> {product.unit}
        </p>

        {packing && (
          <div className="pack-in reveal">
            <div className="grid-2">
              <label className="field">
                <span>Pieces per pack</span>
                <input className="input" type="number" min="2" step="1" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
              </label>
              <label className="field">
                <span>
                  Pack price <small className="muted">— optional</small>
                </span>
                <input className="input" type="number" min="0" step="0.01" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} placeholder={product.pack_size ? fmtMoney(Number(product.cost) * product.pack_size) : 'e.g. 250'} />
              </label>
            </div>
            {newUnitCost !== null && (
              <small className={Number(product.price) < newUnitCost ? 'neg' : 'muted'}>
                New cost {fmtMoney(newUnitCost)} per {product.unit} · profit {fmtMoney(Number(product.price) - newUnitCost)} each at {fmtMoney(product.price)}
              </small>
            )}
          </div>
        )}

        {dir === 'out' && (
          <div className="field">
            <span>Why is it being removed?</span>
            <div className="chips">
              {(Object.keys(WHY) as (keyof typeof WHY)[]).map((k) => (
                <button key={k} type="button" className={`chip-btn ${why === k ? 'on' : ''}`} onClick={() => setWhy(k)}>
                  {WHY[k].label}
                </button>
              ))}
            </div>
            {WHY[why].reason === 'waste' && (
              <small className="muted">
                Counted as <b>waste</b>
                {Number(product.cost) > 0 ? ` · about ${fmtMoney(Number(product.cost) * qty)} lost` : ''}. It shows in the inventory log and usage report.
              </small>
            )}
          </div>
        )}

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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const WHY = {
  spoiled: { label: 'Spoiled / expired', reason: 'waste' },
  damaged: { label: 'Damaged', reason: 'waste' },
  used: { label: 'Used in store / staff meal', reason: 'waste' },
  lost: { label: 'Lost / missing', reason: 'adjustment' },
  count: { label: 'Count correction', reason: 'adjustment' },
} as const;
