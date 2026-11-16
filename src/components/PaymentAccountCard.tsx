import { Copy, CreditCard, Landmark, Wallet } from 'lucide-react';
import Modal from './Modal';
import { toast } from '../lib/alerts';
import type { PaymentAccount } from '../lib/types';

export const kindIcon = (kind: PaymentAccount['kind'], size = 18, provider = '') =>
  kind === 'ewallet' ? <Wallet size={size} /> : /card|visa|master/i.test(provider) ? <CreditCard size={size} /> : <Landmark size={size} />;

export const maskNumber = (n: string | null) => (n ? (n.length > 6 ? `•••• ${n.slice(-4)}` : n) : 'QR only');

/** Big card shown to the customer: QR + account name + number. */
export default function PaymentAccountCard({
  account,
  amount,
  onClose,
}: {
  account: PaymentAccount | null;
  amount?: string;
  onClose: () => void;
}) {
  if (!account) return null;
  const copy = () => {
    if (!account.account_number) return;
    navigator.clipboard?.writeText(account.account_number);
    toast('Account number copied');
  };

  return (
    <Modal open onClose={onClose} title={account.provider} subtitle={account.kind === 'ewallet' ? 'E-wallet' : 'Bank / Card'}>
      <div className="pay-card">
        {amount && (
          <div className="pay-amount">
            <span className="eyebrow">Amount to pay</span>
            <b className="display">{amount}</b>
          </div>
        )}
        {account.qr_url ? (
          <div className="pay-qr">
            <img src={account.qr_url} alt={`${account.provider} QR code`} />
          </div>
        ) : (
          <div className="pay-noqr">{kindIcon(account.kind, 34, account.provider)}</div>
        )}
        <div className="pay-details">
          <div>
            <span className="eyebrow">Account name</span>
            <strong>{account.account_name}</strong>
          </div>
          {account.account_number && (
            <div>
              <span className="eyebrow">Account number</span>
              <button type="button" className="pay-number mono" onClick={copy} title="Copy">
                {account.account_number} <Copy size={14} />
              </button>
            </div>
          )}
        </div>
        <p className="muted small center">Ask the customer to show the confirmation screen, then enter the reference number.</p>
      </div>
    </Modal>
  );
}
