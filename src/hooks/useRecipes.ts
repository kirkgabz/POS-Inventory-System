import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { RecipeLine } from '../lib/types';

/** All recipe lines (store-sized), kept live. Grouped by menu item. */
export function useRecipes() {
  const [lines, setLines] = useState<RecipeLine[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('recipe_items').select('menu_id, ingredient_id, qty').limit(10000);
    setLines(((data as RecipeLine[]) ?? []).map((l) => ({ ...l, qty: Number(l.qty) })));
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`recipes-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_items' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const byMenu = useMemo(() => {
    const m = new Map<string, RecipeLine[]>();
    lines.forEach((l) => m.set(l.menu_id, [...(m.get(l.menu_id) ?? []), l]));
    return m;
  }, [lines]);

  return { lines, byMenu, reload: load };
}
