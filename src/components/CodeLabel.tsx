import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import { isValidEan13 } from '../lib/codes';
import { STORE_NAME, fmtMoney } from '../lib/format';

interface Props {
  name: string;
  price: number;
  barcode?: string | null;
  wordCode?: string | null;
  compact?: boolean;
}

/** Renders the barcode + word code (as Code-128 and QR) and lets you print a sticker label. */
export default function CodeLabel({ name, price, barcode, wordCode, compact }: Props) {
  const barRef = useRef<SVGSVGElement>(null);
  const wordRef = useRef<SVGSVGElement>(null);
  const [qr, setQr] = useState<string>('');

  useEffect(() => {
    if (barRef.current && barcode) {
      try {
        JsBarcode(barRef.current, barcode, {
          format: isValidEan13(barcode) ? 'EAN13' : 'CODE128',
          height: compact ? 40 : 56,
          width: 1.6,
          fontSize: 13,
          margin: 4,
          background: 'transparent',
          lineColor: '#1f1c18',
          font: 'DM Mono',
        });
      } catch {
        /* invalid code */
      }
    }
  }, [barcode, compact]);

  useEffect(() => {
    if (wordRef.current && wordCode) {
      try {
        JsBarcode(wordRef.current, wordCode, {
          format: 'CODE128',
          height: compact ? 34 : 46,
          width: 1.3,
          displayValue: false,
          margin: 4,
          background: 'transparent',
          lineColor: '#1f1c18',
        });
      } catch {
        /* ignore */
      }
      QRCode.toDataURL(wordCode, { margin: 1, width: 160, color: { dark: '#1f1c18', light: '#00000000' } })
        .then(setQr)
        .catch(() => setQr(''));
    } else setQr('');
  }, [wordCode, compact]);

  const print = () => {
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    const bar = barRef.current?.outerHTML ?? '';
    const word = wordRef.current?.outerHTML ?? '';
    w.document.write(`<!doctype html><html><head><title>Label · ${escapeHtml(name)}</title>
      <style>
        @page { size: 58mm auto; margin: 3mm; }
        body { font-family: 'DM Sans', system-ui, sans-serif; margin: 0; color: #1f1c18; }
        .lbl { width: 52mm; padding: 2mm; border: 1px dashed #bbb; text-align: center; page-break-inside: avoid; }
        .store { font-size: 8pt; letter-spacing: .2em; text-transform: uppercase; color: #777; }
        .name { font-size: 11pt; font-weight: 600; margin: 1mm 0; }
        .price { font-size: 14pt; font-weight: 700; }
        .word { font-family: 'DM Mono', monospace; font-size: 9pt; letter-spacing: .08em; }
        svg { max-width: 100%; height: auto; }
        .row { display: flex; align-items: center; justify-content: center; gap: 2mm; }
        img { width: 16mm; height: 16mm; }
      </style></head><body>
      <div class="lbl">
        <div class="store">${escapeHtml(STORE_NAME)}</div>
        <div class="name">${escapeHtml(name)}</div>
        <div class="price">${escapeHtml(fmtMoney(price))}</div>
        ${bar}
        ${wordCode ? `<div class="row">${qr ? `<img src="${qr}"/>` : ''}<div>${word}<div class="word">${escapeHtml(wordCode)}</div></div></div>` : ''}
      </div>
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); }<\/script>
      </body></html>`);
    w.document.close();
  };

  if (!barcode && !wordCode) return null;

  return (
    <div className={`code-label ${compact ? 'compact' : ''}`}>
      {barcode && (
        <div className="code-block">
          <span className="eyebrow">Barcode</span>
          <svg ref={barRef} />
        </div>
      )}
      {wordCode && (
        <div className="code-block code-word">
          <span className="eyebrow">Word code</span>
          <div className="code-word-row">
            {qr && <img src={qr} alt="QR code" className="qr" />}
            <div>
              <svg ref={wordRef} />
              <div className="mono word-text">{wordCode}</div>
            </div>
          </div>
        </div>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={print}>
        <Printer size={14} /> Print label
      </button>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
