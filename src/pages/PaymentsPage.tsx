import { useEffect, useState, type FormEvent } from 'react';
import { Eye, ImagePlus, Landmark, Loader2, Pencil, Plus, QrCode, Trash2, Wallet } from 'lucide-react';
import Modal from '../components/Modal';
import PaymentAccountCard, { maskNumber } from '../components/PaymentAccountCard';
import { usePaymentAccounts } from '../hooks/usePaymentAccounts';
import { supabase, errorMessage } from '../lib/supabase';
import { uploadPaymentQr } from '../lib/storage';
import { confirmAction, failure, success } from '../lib/alerts';
import type { PaymentAccount, PaymentKind } from '../lib/types';

const PROVIDERS: Record<PaymentKind, string[]> = {
  ewallet: ['GCash', 'Maya', 'GoTyme', 'ShopeePay', 'GrabPay', 'Coins.ph'],
  bank: ['BDO', 'BPI', 'Metrobank', 'UnionBank', 'Landbank', 'Security Bank', 'PNB', 'RCBC', 'Card terminal'],
};

export default function PaymentsPage() {
  const { accounts, setAccounts, loading } = usePaymentAccounts(true);
  const [editing, setEditing] = useState<PaymentAccount | 'new' | null>(null);
  const [preview, setPreview] = useState<PaymentAccount | null>(null);

  const remove = async (a: PaymentAccount) => {
    const ok = await confirmAction({
      title: 'Remove this account?',
      html: `<b>${a.provider}</b> · ${a.account_name}<br/><small>Staff will no longer see it at the register.</small>`,
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('payment_accounts').delete().eq('id', a.id);
    if (error) return failure('Could not remove', errorMessage(error));
    setAccounts((l) => l.filter((x) => x.id !== a.id));
    success('Account removed');
  };

  const toggle = async (a: PaymentAccount) => {
    const ok = await confirmAction({
      title: a.is_active ? 'Hide at the register?' : 'Show at the register?',
      html: `<b>${a.provider}</b> · ${a.account_name}`,
      confirmText: a.is_active ? 'Hide' : 'Show',
    });
    if (!ok) return;
    const { error } = await supabase.from('payment_accounts').update({ is_active: !a.is_active }).eq('id', a.id);
    if (error) return failure('Could not update', errorMessage(error));
    setAccounts((l) => l.map((x) => (x.id === a.id ? { ...x, is_active: !a.is_active } : x)));
    success(a.is_active ? 'Hidden' : 'Visible at the register');
  };

  const section = (kind: PaymentKind) => {
    const list = accounts.filter((a) => a.kind === kind);
    return (
      <section className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">{kind === 'ewallet' ? 'GCash, Maya…' : 'Bank transfer & cards'}</span>
            <h3 className="display">{kind === 'ewallet' ? 'E-wallets' : 'Bank / Card'}</h3>
          </div>
          {kind === 'ewallet' ? <Wallet size={18} className="muted" /> : <Landmark size={18} className="muted" />}
        </header>
        {loading ? (
          <div className="skeleton" style={{ height: 70 }} />
        ) : list.length === 0 ? (
          <p className="muted small">None yet — this option shows as <b>Unavailable</b> at the register.</p>
        ) : (
          <div className="acct-list">
            {list.map((a) => (
              <div key={a.id} className={`acct ${a.is_active ? '' : 'inactive'} row-in`}>
                <div className="acct-qr">{a.qr_url ? <img src={a.qr_url} alt="" /> : <QrCode size={20} strokeWidth={1.3} />}</div>
                <div className="grow">
                  <strong>{a.provider}</strong>
                  <div className="muted small">
                    {a.account_name} · <span className="mono">{maskNumber(a.account_number)}</span>
                  </div>
                </div>
                <label className="switch" title="Show at register">
                  <input type="checkbox" checked={a.is_active} onChange={() => toggle(a)} />
                  <i />
                </label>
                <button className="icon-btn" title="Preview" onClick={() => setPreview(a)}>
                  <Eye size={16} />
                </button>
                <button className="icon-btn" title="Edit" onClick={() => setEditing(a)}>
                  <Pencil size={16} />
                </button>
                <button className="icon-btn danger" title="Remove" onClick={() => remove(a)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">Store owner</span>
          <h1 className="display">Payment accounts</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Add account
        </button>
      </header>
      <p className="muted">
        Add the e-wallet and bank/card accounts customers can pay into. At the register, staff tap an account to show its QR code, account name and number.
      </p>
      {section('ewallet')}
      {section('bank')}

      <AccountForm
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={(a) =>
          setAccounts((l) => (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a]))
        }
      />
      <PaymentAccountCard account={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function AccountForm({
  account,
  onClose,
  onSaved,
}: {
  account: PaymentAccount | 'new' | null;
  onClose: () => void;
  onSaved: (a: PaymentAccount) => void;
}) {
  const editing = account && account !== 'new' ? account : null;
  const [kind, setKind] = useState<PaymentKind>('ewallet');
  const [provider, setProvider] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [qr, setQr] = useState<{ file: File; url: string } | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) return;
    setKind(editing?.kind ?? 'ewallet');
    setProvider(editing?.provider ?? '');
    setName(editing?.account_name ?? '');
    setNumber(editing?.account_number ?? '');
    setQrUrl(editing?.qr_url ?? null);
    setQr(null);
  }, [account, editing]);

  if (!account) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!number.trim() && !qr && !qrUrl) {
      failure('Add a number or QR code', 'Customers need at least one way to pay.');
      return;
    }
    const ok = await confirmAction({
      title: editing ? 'Save changes?' : 'Add this account?',
      html: `<b>${provider}</b> · ${name}${number ? `<br/><span class="mono">${number}</span>` : ''}`,
      confirmText: editing ? 'Save' : 'Add account',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const url = qr ? await uploadPaymentQr(qr.file) : qrUrl;
      const row = {
        kind,
        provider: provider.trim(),
        account_name: name.trim(),
        account_number: number.trim() || null,
        qr_url: url,
      };
      const { data, error } = editing
        ? await supabase.from('payment_accounts').update(row).eq('id', editing.id).select().single()
        : await supabase.from('payment_accounts').insert(row).select().single();
      if (error) throw error;
      onSaved(data as PaymentAccount);
      onClose();
      success(editing ? 'Account updated' : 'Account added', `${row.provider} is ready at the register.`);
    } catch (err) {
      failure('Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const shownQr = qr?.url ?? qrUrl;

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit account' : 'New payment account'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button form="acct-form" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 size={15} className="spin" />} {editing ? 'Save' : 'Add account'}
          </button>
        </>
      }
    >
      <form id="acct-form" className="stack" onSubmit={save}>
        <div className="seg seg-wide">
          <button type="button" className={kind === 'ewallet' ? 'on' : ''} onClick={() => setKind('ewallet')}>
            <Wallet size={15} /> E-wallet
          </button>
          <button type="button" className={kind === 'bank' ? 'on' : ''} onClick={() => setKind('bank')}>
            <Landmark size={15} /> Bank / Card
          </button>
          <i className={`seg-pill ${kind === 'bank' ? 'right' : ''}`} />
        </div>
        <label className="field">
          <span>{kind === 'ewallet' ? 'E-wallet' : 'Bank or card'}</span>
          <input className="input" required list="provider-list" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={kind === 'ewallet' ? 'GCash' : 'BDO'} />
          <datalist id="provider-list">
            {PROVIDERS[kind].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Account name</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan D." />
        </label>
        <label className="field">
          <span>Account / mobile number</span>
          <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value)} placeholder={kind === 'ewallet' ? '0917 123 4567' : '0012 3456 7890'} />
        </label>
        <div className="field">
          <span>QR code {!shownQr && <small className="muted">(optional if there's a number)</small>}</span>
          <input
            id="qr-input"
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setQr({ file: f, url: URL.createObjectURL(f) });
              e.target.value = '';
            }}
          />
          {shownQr ? (
            <div className="qr-edit">
              <img src={shownQr} alt="QR preview" />
              <div className="row gap-sm">
                <label htmlFor="qr-input" className="btn btn-ghost btn-sm">
                  <ImagePlus size={14} /> Replace
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm danger-text"
                  onClick={() => {
                    setQr(null);
                    setQrUrl(null);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <label htmlFor="qr-input" className="photo-box qr-drop">
              <span className="photo-empty">
                <QrCode size={24} strokeWidth={1.3} />
                <span>Upload QR code image</span>
              </span>
            </label>
          )}
        </div>
      </form>
    </Modal>
  );
}
