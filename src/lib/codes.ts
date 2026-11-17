/**
 * Code generation for products that have no manufacturer barcode
 * (store-owned / home-made / repacked items).
 *
 *  - EAN-13 starting with "2": the GS1 range reserved for in-store use, so it
 *    never collides with real retail barcodes and any USB scanner reads it.
 *  - Word code: readable short code like  TB-MANG-7K2Q  — printed as a
 *    Code-128 barcode + QR so the camera can scan it too, and staff can type it.
 */

const PREFIX = ((import.meta.env.VITE_CODE_PREFIX as string) || 'TB').toUpperCase();
// No 0/O/1/I to avoid confusion when typed by hand
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function generateEan13(): string {
  let body = '2';
  for (let i = 0; i < 11; i++) body += randomInt(10).toString();
  return body + ean13CheckDigit(body);
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export function generateWordCode(name: string): string {
  const stem =
    name
      .toUpperCase()
      .normalize('NFD')
      .replace(/[^A-Z0-9 ]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 2)
      .map((w, i) => w.slice(0, i === 0 ? 4 : 2))
      .join('') || 'ITEM';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += ALPHABET[randomInt(ALPHABET.length)];
  return `${PREFIX}-${stem}-${tail}`;
}

/** Normalise any scanned / typed code so lookups are forgiving. */
export const normaliseCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

/** Random 4-char tail, reused so the word code stays stable while the name is typed. */
export function randomTail(): string {
  let tail = '';
  for (let i = 0; i < 4; i++) tail += ALPHABET[randomInt(ALPHABET.length)];
  return tail;
}

export function wordCodeFor(name: string, tail: string): string {
  return generateWordCode(name).replace(/-[A-Z0-9]{4}$/, `-${tail}`);
}
