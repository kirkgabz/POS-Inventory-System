import { supabase } from './supabase';

/** Ingredient usage for a period: used in sales, wasted, restocked — with peso value at current cost. */
export interface UsageRow {
  id: string;
  name: string;
  unit: string;
  cost: number;
  used: number;
  wasted: number;
  restocked: number;
  adjusted: number;
  stock: number;
}

export async function fetchIngredientUsage(start: Date, end: Date): Promise<UsageRow[]> {
  const PAGE = 1000;
  const map = new Map<string, UsageRow>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('change, reason, product:products!inner(id, name, unit, cost, stock, kind)')
      .eq('product.kind', 'ingredient')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as {
      change: number;
      reason: string;
      product: { id: string; name: string; unit: string; cost: number; stock: number };
    }[];
    rows.forEach((m) => {
      const p = m.product;
      const g =
        map.get(p.id) ?? { id: p.id, name: p.name, unit: p.unit, cost: Number(p.cost), stock: p.stock, used: 0, wasted: 0, restocked: 0, adjusted: 0 };
      if (m.reason === 'sale') g.used += -m.change;
      else if (m.reason === 'waste') g.wasted += -m.change;
      else if (m.reason === 'restock' || m.reason === 'initial') g.restocked += m.change;
      else g.adjusted += m.change;
      map.set(p.id, g);
    });
    if (rows.length < PAGE) break;
  }
  return [...map.values()].sort((a, b) => b.used * b.cost - a.used * a.cost || a.name.localeCompare(b.name));
}

/** Big amounts in friendlier units: 6200 ml → 6.2 L, 1500 g → 1.5 kg. */
export function niceQty(n: number, unit: string) {
  if (unit === 'ml' && Math.abs(n) >= 1000) return `${+(n / 1000).toFixed(2)} L`;
  if (unit === 'g' && Math.abs(n) >= 1000) return `${+(n / 1000).toFixed(2)} kg`;
  return `${n} ${unit}`;
}
