import type { Product, RecipeLine } from './types';

export const kindOf = (p: Pick<Product, 'kind'>) => p.kind ?? 'item';
export const isMenu = (p: Pick<Product, 'kind'>) => kindOf(p) === 'menu';
export const isIngredient = (p: Pick<Product, 'kind'>) => kindOf(p) === 'ingredient';

/** Units that suit ingredients (recipes deduct whole units, so pick small ones). */
export const INGREDIENT_UNITS = ['g', 'ml', 'pc', 'slice', 'leaf', 'pump', 'tbsp', 'tsp', 'sachet'];

export interface Shortfall {
  ingredient: Product;
  need: number;
  have: number;
}

/** How many of a menu item can be made from current ingredient stock (null = no recipe yet). */
export function canMake(recipe: RecipeLine[] | undefined, byId: Map<string, Product>): number | null {
  if (!recipe?.length) return null;
  let n = Infinity;
  for (const l of recipe) {
    const ing = byId.get(l.ingredient_id);
    if (!ing) return 0;
    n = Math.min(n, Math.floor(Math.max(0, ing.stock) / l.qty));
  }
  return n === Infinity ? null : n;
}

/** Cost of one serving from the ingredients' current cost per unit. */
export function recipeCost(recipe: { ingredient_id: string; qty: number }[] | undefined, byId: Map<string, Product>): number {
  return (recipe ?? []).reduce((s, l) => s + Number(byId.get(l.ingredient_id)?.cost ?? 0) * l.qty, 0);
}

/** Which ingredients would run short for `servings` of the menu item (plus what's already reserved). */
export function shortfalls(recipe: RecipeLine[] | undefined, byId: Map<string, Product>, servings: number, reserved = new Map<string, number>()): Shortfall[] {
  const out: Shortfall[] = [];
  (recipe ?? []).forEach((l) => {
    const ing = byId.get(l.ingredient_id);
    if (!ing) return;
    const need = l.qty * servings + (reserved.get(ing.id) ?? 0);
    if (need > ing.stock) out.push({ ingredient: ing, need, have: ing.stock });
  });
  return out;
}
