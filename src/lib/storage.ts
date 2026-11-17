import { supabase } from './supabase';
import { compressImage } from './imageScan';
import { generateEan13 } from './codes';

const BUCKET = 'product-images';

/** Compress + upload a product photo, return its public URL. */
export async function uploadProductPhoto(file: File): Promise<string> {
  const blob = await compressImage(file);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `products/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** EAN-13 in the in-store "2" range, verified not to exist in the database. */
export async function uniqueEan13(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = generateEan13();
    const { data } = await supabase.from('products').select('id').eq('barcode', code).maybeSingle();
    if (!data) return code;
  }
  return generateEan13();
}

/** Upload a payment QR code — kept as sharp PNG so it stays scannable. */
export async function uploadPaymentQr(file: File): Promise<string> {
  const blob = await compressImage(file, 1100, 'image/png');
  const path = `payment-qr/${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Upload the store logo for receipts (PNG keeps transparency). */
export async function uploadReceiptLogo(file: File): Promise<string> {
  const blob = await compressImage(file, 600, 'image/png');
  const path = `receipt/logo-${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
