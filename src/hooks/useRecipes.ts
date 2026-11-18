import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ComboItem, MenuOption, MenuOptionItem, RecipeLine } from '../lib/types';
import type { RecipeData } from '../lib/recipes';

/** Recipes, add-on options and combo contents (store-sized), kept live. */
export function useRecipes() {
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [options, setOptions] = useState<MenuOption[]>([]);
  const [optionItems, setOptionItems] = useState<MenuOptionItem[]>([]);
  const [comboItems, setComboItems] = useState<ComboItem[]>([]);

  const load = useCallback(async () => {
    const [r, o, oi, c] = await Promise.all([
      supabase.from('recipe_items').select('menu_id, ingredient_id, qty').limit(10000),
      supabase.from('menu_options').select('id, menu_id, name, price_delta, sort').order('sort').limit(5000),
      supabase.from('menu_option_items').select('option_id, ingredient_id, qty').limit(10000),
      supabase.from('combo_items').select('combo_id, component_id, qty').limit(5000),
    ]);
    setLines(((r.data as RecipeLine[]) ?? []).map((l) => ({ ...l, qty: Number(l.qty) })));
    setOptions(((o.data as MenuOption[]) ?? []).map((x) => ({ ...x, price_delta: Number(x.price_delta) })));
    setOptionItems(((oi.data as MenuOptionItem[]) ?? []).map((x) => ({ ...x, qty: Number(x.qty) })));
    setComboItems(((c.data as ComboItem[]) ?? []).map((x) => ({ ...x, qty: Number(x.qty) })));
  }, []);

  useEffect(() => {
    load();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(load, 250);
    };
    const ch = supabase
      .channel(`recipes-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_items' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_options' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_option_items' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combo_items' }, soon)
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [load]);

  const data = useMemo<RecipeData>(() => {
    const group = <T, K extends keyof T>(list: T[], key: K) => {
      const m = new Map<string, T[]>();
      list.forEach((x) => m.set(String(x[key]), [...(m.get(String(x[key])) ?? []), x]));
      return m;
    };
    return {
      byMenu: group(lines, 'menu_id'),
      optionsByMenu: group(options, 'menu_id'),
      optionItems: group(optionItems, 'option_id'),
      byCombo: group(comboItems, 'combo_id'),
    };
  }, [lines, options, optionItems, comboItems]);

  return { ...data, data, reload: load };
}
