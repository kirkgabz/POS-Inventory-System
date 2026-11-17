import JsBarcode from 'jsbarcode';
import { supabase } from './supabase';
import { STORE_NAME, fmtMoney, methodLabel } from './format';

export interface ReceiptSettings {
  business_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tin: string | null;
  business_permit: string | null;
  vat_registered: boolean;
  vat_rate: number;
  header_note: string | null;
  footer_message: string | null;
  show_cashier: boolean;
  show_barcode: boolean;
  show_not_official: boolean;
  paper_width: '58mm' | '80mm' | 'A4';
}

export const DEFAULT_RECEIPT: ReceiptSettings = {
  business_name: null,
  tagline: null,
  logo_url: null,
  address: null,
  phone: null,
  email: null,
  tin: null,
  business_permit: null,
  vat_registered: false,
  vat_rate: 12,
  header_note: null,
  footer_message: 'Thank you, come again!',
  show_cashier: true,
  show_barcode: true,
  show_not_official: true,
  paper_width: '58mm',
};

export interface ReceiptData {
  receipt_no: string;
  at: string;
  cashier?: string | null;
  lines: { name: string; quantity: number; unit_price: number }[];
  subtotal: number;
  discount: number;
  total: number;
  method: string;
  amount_paid: number;
  change: number;
  account?: string | null;
  ref?: string | null;
  reprint?: boolean;
}

let cache: ReceiptSettings | null = null;

export async function getReceiptSettings(force = false): Promise<ReceiptSettings> {
  if (cache && !force) return cache;
  const { data } = await supabase.from('receipt_settings').select('*').eq('id', 1).maybeSingle();
  cache = { ...DEFAULT_RECEIPT, ...(data ?? {}), vat_rate: Number(data?.vat_rate ?? 12) } as ReceiptSettings;
  return cache;
}
export const setReceiptCache = (s: ReceiptSettings) => {
  cache = s;
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function barcodeSvg(text: string): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, text, { format: 'CODE128', height: 34, width: 1.4, displayValue: false, margin: 0, background: 'transparent' });
    return svg.outerHTML;
  } catch {
    return '';
  }
}

/** Full standalone HTML document for a receipt (used for print + live preview). */
export function receiptHtml(r: ReceiptData, s: ReceiptSettings, opts: { autoPrint?: boolean } = {}): string {
  const name = s.business_name?.trim() || STORE_NAME;
  const when = new Date(r.at);
  const date = when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const width = s.paper_width === 'A4' ? '190mm' : s.paper_width === '80mm' ? '72mm' : '50mm';
  const base = s.paper_width === 'A4' ? 11 : s.paper_width === '80mm' ? 10 : 9;
  const vatable = s.vat_registered ? r.total / (1 + s.vat_rate / 100) : 0;
  const vat = s.vat_registered ? r.total - vatable : 0;
  const items = r.lines.reduce((n, l) => n + l.quantity, 0);
  const row = (a: string, b: string, cls = '') => `<div class="r ${cls}"><span>${a}</span><span>${b}</span></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.receipt_no)}</title><style>
    @page { size: ${s.paper_width === 'A4' ? 'A4' : `${s.paper_width} auto`}; margin: ${s.paper_width === 'A4' ? '12mm' : '2mm'}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #000; font: ${base}pt/1.35 'DM Mono', ui-monospace, Menlo, Consolas, monospace; }
    .rc { width: ${width}; margin: 0 auto; padding: 2mm 0; }
    .c { text-align: center; }
    .logo { display: block; max-width: 60%; max-height: 22mm; margin: 0 auto 1.5mm; object-fit: contain; }
    .name { font: 700 ${base + 4}pt/1.15 Georgia, 'Times New Roman', serif; text-align: center; letter-spacing: .01em; }
    .tag { text-align: center; font-style: italic; margin-top: .5mm; }
    .meta { text-align: center; margin-top: 1mm; white-space: pre-line; }
    .note { text-align: center; margin-top: 1.5mm; white-space: pre-line; }
    hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
    hr.solid { border-top-style: solid; }
    .r { display: flex; justify-content: space-between; gap: 2mm; }
    .r span:last-child { text-align: right; white-space: nowrap; }
    .item { margin-bottom: 1mm; }
    .item .nm { word-break: break-word; }
    .muted { color: #333; }
    .big { font-weight: 700; font-size: ${base + 3}pt; }
    .b { font-weight: 700; }
    .title { text-align: center; font-weight: 700; letter-spacing: .25em; margin: 1mm 0; }
    .reprint { text-align: center; font-weight: 700; border: 1px solid #000; padding: .5mm; margin-bottom: 1.5mm; letter-spacing: .2em; }
    .bc { text-align: center; margin-top: 2mm; }
    .bc svg { width: 85%; height: 10mm; }
    .foot { text-align: center; margin-top: 2mm; white-space: pre-line; }
    .legal { text-align: center; font-size: ${base - 1}pt; margin-top: 2mm; font-weight: 700; }
  </style></head><body><div class="rc">
    ${r.reprint ? '<div class="reprint">REPRINT</div>' : ''}
    ${s.logo_url ? `<img class="logo" src="${esc(s.logo_url)}" alt="">` : ''}
    <div class="name">${esc(name)}</div>
    ${s.tagline ? `<div class="tag">${esc(s.tagline)}</div>` : ''}
    <div class="meta">${[s.address, s.phone && `Tel: ${s.phone}`, s.email].filter(Boolean).map(esc).join('\n')}</div>
    ${s.tin || s.business_permit ? `<div class="meta">${[s.tin && `${s.vat_registered ? 'VAT REG ' : 'NON-VAT REG '}TIN: ${s.tin}`, s.business_permit && `Permit No: ${s.business_permit}`].filter(Boolean).map(esc).join('\n')}</div>` : ''}
    ${s.header_note ? `<div class="note">${esc(s.header_note)}</div>` : ''}
    <hr class="solid">
    <div class="title">SALES INVOICE</div>
    ${row('Receipt #', esc(r.receipt_no), 'b')}
    ${row('Date', `${esc(date)} ${esc(time)}`)}
    ${s.show_cashier && r.cashier ? row('Cashier', esc(r.cashier)) : ''}
    <hr>
    ${r.lines
      .map(
        (l) => `<div class="item"><div class="nm">${esc(l.name)}</div>${row(
          `&nbsp;&nbsp;${l.quantity} x ${esc(fmtMoney(l.unit_price))}`,
          esc(fmtMoney(l.quantity * l.unit_price)),
        )}</div>`,
      )
      .join('')}
    <hr>
    ${row(`Subtotal (${items} item${items === 1 ? '' : 's'})`, esc(fmtMoney(r.subtotal)))}
    ${r.discount > 0 ? row('Discount', `-${esc(fmtMoney(r.discount))}`) : ''}
    ${row('TOTAL', esc(fmtMoney(r.total)), 'big')}
    <hr>
    ${row(esc(methodLabel(r.method)), esc(fmtMoney(r.amount_paid)))}
    ${r.method === 'cash' ? row('Change', esc(fmtMoney(r.change)), 'b') : ''}
    ${r.account ? row('Paid to', esc(r.account)) : ''}
    ${r.ref ? row('Ref #', esc(r.ref)) : ''}
    ${
      s.vat_registered
        ? `<hr>${row('VATable sales', esc(fmtMoney(vatable)))}${row(`VAT (${s.vat_rate}%)`, esc(fmtMoney(vat)))}${row('VAT-exempt sales', esc(fmtMoney(0)))}${row('Zero-rated sales', esc(fmtMoney(0)))}`
        : ''
    }
    ${s.show_barcode ? `<div class="bc">${barcodeSvg(r.receipt_no)}<div>${esc(r.receipt_no)}</div></div>` : ''}
    ${s.footer_message ? `<div class="foot">${esc(s.footer_message)}</div>` : ''}
    ${s.show_not_official ? '<div class="legal">THIS IS NOT AN OFFICIAL RECEIPT</div>' : ''}
  </div>
  ${opts.autoPrint ? `<script>window.onload=()=>{setTimeout(()=>{window.print();setTimeout(()=>window.close(),300)},${s.logo_url ? 350 : 50})}<\/script>` : ''}
  </body></html>`;
}

export async function printReceipt(r: ReceiptData) {
  const s = await getReceiptSettings();
  const w = window.open('', '_blank', `width=${s.paper_width === 'A4' ? 820 : 420},height=720`);
  if (!w) return false;
  w.document.write(receiptHtml(r, s, { autoPrint: true }));
  w.document.close();
  return true;
}

/** Example order for previews / test prints. */
export const SAMPLE_RECEIPT: ReceiptData = {
  receipt_no: 'R261117-00042',
  at: new Date().toISOString(),
  cashier: 'Maria Santos',
  lines: [
    { name: 'Blue Hair Clip', quantity: 2, unit_price: 50 },
    { name: 'Homemade Ube Jam 250g', quantity: 1, unit_price: 185 },
    { name: 'Mineral Water 500ml', quantity: 3, unit_price: 20 },
  ],
  subtotal: 345,
  discount: 15,
  total: 330,
  method: 'cash',
  amount_paid: 500,
  change: 170,
};
