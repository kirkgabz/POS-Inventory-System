/**
 * Look up a product's details from its barcode using the free, open
 * Open Food Facts family of databases (food, cosmetics/beauty, other products).
 * Only the barcode number is sent. Coverage is good for big brands; small
 * local products may not be listed — then staff type the name themselves.
 */
export interface LookupResult {
  name: string;
  brand?: string;
  quantity?: string;
  category?: string;
  imageUrl?: string;
  source: string;
}

const SOURCES = [
  { base: 'https://world.openfoodfacts.org', label: 'Open Food Facts' },
  { base: 'https://world.openbeautyfacts.org', label: 'Open Beauty Facts' },
  { base: 'https://world.openproductsfacts.org', label: 'Open Products Facts' },
];

const FIELDS = 'product_name,product_name_en,generic_name,brands,quantity,categories,image_front_small_url';

async function fetchJson(url: string, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const tidy = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();

export async function lookupBarcode(code: string): Promise<LookupResult | null> {
  if (!/^\d{8,14}$/.test(code)) return null; // only real retail barcodes
  if (code.startsWith('2')) return null; // in-store range: ours, never in public DBs
  const candidates = [code];
  if (code.length === 12) candidates.push('0' + code); // UPC-A ↔ EAN-13

  for (const c of candidates) {
    const results = await Promise.all(
      SOURCES.map(async (s) => ({ s, data: await fetchJson(`${s.base}/api/v2/product/${c}.json?fields=${FIELDS}`) })),
    );
    for (const { s, data } of results) {
      const p = data?.status === 1 ? data.product : null;
      if (!p) continue;
      const base = tidy(p.product_name_en || p.product_name || p.generic_name);
      if (!base) continue;
      const brand = tidy(String(p.brands ?? '').split(',')[0]);
      const quantity = tidy(p.quantity);
      const name = [brand && !base.toLowerCase().includes(brand.toLowerCase()) ? brand : '', base, quantity]
        .filter(Boolean)
        .join(' ');
      const category = tidy(String(p.categories ?? '').split(',')[0]).replace(/^\w{2}:/, '');
      return { name, brand, quantity, category, imageUrl: p.image_front_small_url, source: s.label };
    }
  }
  return null;
}
