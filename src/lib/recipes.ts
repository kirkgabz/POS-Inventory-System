import type { CartLine, ComboItem, MenuOption, MenuOptionItem, Product, RecipeLine } from './types';

export const kindOf = (p: Pick<Product, 'kind'>) => p.kind ?? 'item';
export const isMenu = (p: Pick<Product, 'kind'>) => kindOf(p) === 'menu';
export const isIngredient = (p: Pick<Product, 'kind'>) => kindOf(p) === 'ingredient';
export const isCombo = (p: Pick<Product, 'kind'>) => kindOf(p) === 'combo';
/** sold at the register without a hard stock limit (made from other stock) */
export const isMade = (p: Pick<Product, 'kind'>) => isMenu(p) || isCombo(p);

/** Units that suit ingredients (recipes deduct whole units, so pick small ones). */
export const INGREDIENT_UNITS = ['g', 'ml', 'pc', 'slice', 'leaf', 'pump', 'tbsp', 'tsp', 'sachet'];

export interface RecipeData {
  byMenu: Map<string, RecipeLine[]>;
  optionsByMenu: Map<string, MenuOption[]>;
  optionItems: Map<string, MenuOptionItem[]>;
  byCombo: Map<string, ComboItem[]>;
}

export interface Shortfall {
  ingredient: Product;
  need: number;
  have: number;
}

/* ---------- cart lines ---------- */

export const lineKey = (productId: string, optionIds: string[] = []) => [productId, ...[...optionIds].sort()].join('+');
export const keyOf = (l: CartLine) => l.key ?? lineKey(l.product.id, (l.options ?? []).map((o) => o.id));
export const unitPrice = (l: CartLine) => Math.max(0, l.product.price + (l.options ?? []).reduce((s, o) => s + o.price_delta, 0));
export const optionText = (l: CartLine) => (l.options ?? []).map((o) => o.name).join(', ');
export const lineName = (l: CartLine) => (l.options?.length ? `${l.product.name} (${optionText(l)})` : l.product.name);

/* ---------- what selling something uses up ---------- */

/** stock used (ingredient / item id → amount) by `servings` of a product with the given options */
export function needsOf(p: Product, optionIds: string[], servings: number, d: RecipeData, byId: Map<string, Product>, out = new Map<string, number>()) {
  const add = (id: string, n: number) => n > 0 && out.set(id, (out.get(id) ?? 0) + n);
  if (isMenu(p)) {
    const per = new Map<string, number>();
    d.byMenu.get(p.id)?.forEach((r) => per.set(r.ingredient_id, (per.get(r.ingredient_id) ?? 0) + r.qty));
    optionIds.forEach((o) => d.optionItems.get(o)?.forEach((x) => per.set(x.ingredient_id, (per.get(x.ingredient_id) ?? 0) + x.qty)));
    per.forEach((q, id) => add(id, Math.max(0, q) * servings));
  } else if (isCombo(p)) {
    d.byCombo.get(p.id)?.forEach((c) => {
      const comp = byId.get(c.component_id);
      if (!comp) return;
      if (isMenu(comp)) needsOf(comp, [], c.qty * servings, d, byId, out);
      else add(comp.id, c.qty * servings);
    });
  } else {
    add(p.id, servings);
  }
  return out;
}

/** everything the whole order uses up */
export function cartNeeds(lines: CartLine[], d: RecipeData, byId: Map<string, Product>) {
  const out = new Map<string, number>();
  lines.forEach((l) => needsOf(l.product, (l.options ?? []).map((o) => o.id), l.quantity, d, byId, out));
  return out;
}

/** which of `ids` would run short with these needs */
export function shortOf(needs: Map<string, number>, byId: Map<string, Product>, ids?: Iterable<string>): Shortfall[] {
  const out: Shortfall[] = [];
  for (const id of ids ?? needs.keys()) {
    const p = byId.get(id);
    const need = needs.get(id) ?? 0;
    if (p && need > p.stock) out.push({ ingredient: p, need, have: p.stock });
  }
  return out;
}

/** how many can be made from current stock (null = nothing to make it from yet) */
export function canMakeOf(p: Product, d: RecipeData, byId: Map<string, Product>): number | null {
  const needs = needsOf(p, [], 1, d, byId);
  if (!needs.size) return null;
  let n = Infinity;
  needs.forEach((q, id) => {
    const s = byId.get(id)?.stock ?? 0;
    n = Math.min(n, Math.floor(Math.max(0, s) / q));
  });
  return n === Infinity ? null : n;
}

/** kept for the simple recipe-only case */
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
