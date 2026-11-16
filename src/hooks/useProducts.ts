import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Product } from '../lib/types';

/** Loads the full product catalogue (store-sized) and keeps it live via Realtime. */
export function useProducts(includeInactive = false) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('products').select('*').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data } = await q.limit(5000);
    setProducts(((data as Product[]) ?? []).map(normalise));
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`products-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        setProducts((list) => {
          if (payload.eventType === 'DELETE') return list.filter((p) => p.id !== (payload.old as Product).id);
          const p = normalise(payload.new as Product);
          if (!includeInactive && !p.is_active) return list.filter((x) => x.id !== p.id);
          const i = list.findIndex((x) => x.id === p.id);
          if (i === -1) return [...list, p].sort((a, b) => a.name.localeCompare(b.name));
          const next = list.slice();
          next[i] = p;
          return next;
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load, includeInactive]);

  const upsertLocal = useCallback((p: Product) => {
    setProducts((list) => {
      const i = list.findIndex((x) => x.id === p.id);
      const n = normalise(p);
      if (i === -1) return [...list, n].sort((a, b) => a.name.localeCompare(b.name));
      const next = list.slice();
      next[i] = n;
      return next;
    });
  }, []);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(),
    [products],
  );

  /** Find by barcode or word code (case-insensitive). */
  const findByCode = useCallback(
    (code: string) => {
      const c = code.trim().toUpperCase();
      return products.find((p) => p.barcode?.toUpperCase() === c || p.word_code?.toUpperCase() === c) ?? null;
    },
    [products],
  );

  return { products, loading, reload: load, upsertLocal, setProducts, categories, findByCode };
}

const normalise = (p: Product): Product => ({ ...p, price: Number(p.price), cost: Number(p.cost) });
