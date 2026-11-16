import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { normaliseCode } from './codes';

/**
 * Read a barcode from an uploaded photo.
 * Tries several passes (native detector, original, resized, high-contrast,
 * rotated) because phone photos are often large, tilted or dim.
 */
const FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE,
];

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => {
      detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
    };
  }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function toCanvas(img: HTMLImageElement, maxSide: number, rotate = 0, contrast = false): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  const swap = rotate % 180 !== 0;
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d')!;
  if (contrast) ctx.filter = 'grayscale(1) contrast(1.8) brightness(1.05)';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

const canvasToFile = (c: HTMLCanvasElement) =>
  new Promise<File>((resolve) =>
    c.toBlob((b) => resolve(new File([b!], 'scan.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92),
  );

let host: HTMLDivElement | null = null;
function getHost() {
  if (!host) {
    host = document.createElement('div');
    host.id = 'image-scan-host';
    host.style.display = 'none';
    document.body.appendChild(host);
  }
  return host;
}

export async function decodeBarcodeFromImage(file: File): Promise<string | null> {
  const img = await loadImage(file);

  // 1) Native detector (Android Chrome, macOS/iOS Safari 17+) — fast & accurate
  if (window.BarcodeDetector) {
    try {
      const det = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
      });
      for (const rot of [0, 90]) {
        const found = await det.detect(toCanvas(img, 1600, rot));
        if (found[0]?.rawValue) return normaliseCode(found[0].rawValue);
      }
    } catch {
      /* fall through */
    }
  }

  // 2) ZXing via html5-qrcode, several variants
  getHost();
  const scanner = new Html5Qrcode('image-scan-host', { formatsToSupport: FORMATS, verbose: false });
  const variants: [number, number, boolean][] = [
    [1600, 0, false],
    [1000, 0, false],
    [1600, 0, true],
    [2400, 0, false],
    [1400, 90, false],
    [1400, 90, true],
    [1400, 180, false],
  ];
  try {
    for (const [size, rot, contrast] of variants) {
      try {
        const f = await canvasToFile(toCanvas(img, size, rot, contrast));
        const text = await scanner.scanFile(f, false);
        if (text) return normaliseCode(text);
      } catch {
        /* not found in this variant */
      }
    }
    return null;
  } finally {
    try {
      scanner.clear();
    } catch {
      /* ignore */
    }
  }
}

/** Shrink a photo to a web-friendly WebP/JPEG for storage. */
export async function compressImage(file: File, maxSide = 900, type: 'image/webp' | 'image/png' = 'image/webp'): Promise<Blob> {
  const img = await loadImage(file);
  const c = toCanvas(img, maxSide);
  return new Promise((resolve) =>
    c.toBlob((b) => resolve(b ?? file), type, 0.82),
  );
}
