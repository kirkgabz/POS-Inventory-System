export const STORE_NAME = (import.meta.env.VITE_STORE_NAME as string) || 'Jen Store';
const CURRENCY = (import.meta.env.VITE_CURRENCY as string) || 'PHP';
const LOCALE = (import.meta.env.VITE_LOCALE as string) || 'en-PH';

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });

export const fmtMoney = (n: number | string | null | undefined) => money.format(Number(n ?? 0));

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString(LOCALE);
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Human label for a stored payment method (older sales used 'gcash' / 'card'). */
export const methodLabel = (m: string) =>
  ({ cash: 'Cash', ewallet: 'E-wallet', gcash: 'E-wallet', bank: 'Bank / Card', card: 'Bank / Card' } as Record<string, string>)[m] ?? m;
