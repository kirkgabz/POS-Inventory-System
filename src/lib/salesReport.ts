import type { UsageRow } from './usage';
import type { Sale } from './types';
import { buckets, type Period } from './period';
import { STORE_NAME, methodLabel, takenBy } from './format';

export interface SalesSummary {
  revenue: number;
  transactions: number;
  items: number;
  discounts: number;
  average: number;
  cost: number;
  profit: number;
  byMethod: { method: string; count: number; total: number }[];
  byCashier: { name: string; count: number; total: number }[];
  byProduct: { name: string; qty: number; revenue: number; cost: number; profit: number }[];
  breakdown: { label: string; count: number; items: number; revenue: number; discount: number; profit: number }[];
}

export function summarise(sales: Sale[], period: Period): SalesSummary {
  const n = (v: unknown) => Number(v) || 0;
  const revenue = sales.reduce((a, s) => a + n(s.total), 0);
  const discounts = sales.reduce((a, s) => a + n(s.discount), 0);
  const allItems = sales.flatMap((s) => s.sale_items ?? []);
  const items = allItems.reduce((a, i) => a + i.quantity, 0);
  const cost = allItems.reduce((a, i) => a + n(i.unit_cost) * i.quantity, 0);

  const group = <K extends string>(keyOf: (s: Sale) => K) => {
    const m = new Map<K, { count: number; total: number }>();
    sales.forEach((s) => {
      const k = keyOf(s);
      const g = m.get(k) ?? { count: 0, total: 0 };
      g.count++;
      g.total += n(s.total);
      m.set(k, g);
    });
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  };

  const prod = new Map<string, { qty: number; revenue: number; cost: number }>();
  allItems.forEach((i) => {
    const g = prod.get(i.name) ?? { qty: 0, revenue: 0, cost: 0 };
    g.qty += i.quantity;
    g.revenue += n(i.line_total);
    g.cost += n(i.unit_cost) * i.quantity;
    prod.set(i.name, g);
  });

  const breakdown = buckets(period).map((b) => {
    const inB = sales.filter((s) => {
      const t = new Date(s.created_at);
      return t >= b.start && t < b.end;
    });
    const its = inB.flatMap((s) => s.sale_items ?? []);
    const rev = inB.reduce((a, s) => a + n(s.total), 0);
    const c = its.reduce((a, i) => a + n(i.unit_cost) * i.quantity, 0);
    return {
      label: b.label,
      count: inB.length,
      items: its.reduce((a, i) => a + i.quantity, 0),
      revenue: rev,
      discount: inB.reduce((a, s) => a + n(s.discount), 0),
      profit: rev - c,
    };
  });

  return {
    revenue,
    transactions: sales.length,
    items,
    discounts,
    average: sales.length ? revenue / sales.length : 0,
    cost,
    profit: revenue - cost,
    byMethod: group((s) => s.payment_method).map(([method, g]) => ({ method, ...g })),
    byCashier: group((s) => takenBy(s)).map(([name, g]) => ({ name, ...g })),
    byProduct: [...prod.entries()]
      .map(([name, g]) => ({ name, ...g, profit: g.revenue - g.cost }))
      .sort((a, b) => b.revenue - a.revenue),
    breakdown,
  };
}

/* ------------------------------------------------------------------ */

const PESO = '"₱"#,##0.00';
const INK = 'FF1F1C18';
const PAPER = 'FFF5F1EA';
const ACCENT = 'FFC8623F';

export async function downloadSalesExcel(sales: Sale[], period: Period, generatedBy: string, usage: UsageRow[] = []) {
  const ExcelJS = (await import('exceljs')).default;
  const s = summarise(sales, period);
  const wb = new ExcelJS.Workbook();
  wb.creator = STORE_NAME;
  wb.created = new Date();

  type WS = ReturnType<typeof wb.addWorksheet>;

  const headerRow = (ws: WS, rowNo: number) => {
    const row = ws.getRow(rowNo);
    row.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
      c.alignment = { vertical: 'middle' };
    });
    row.height = 20;
  };
  const totalRow = (ws: WS, rowNo: number) => {
    ws.getRow(rowNo).eachCell((c) => {
      c.font = { bold: true };
      c.border = { top: { style: 'thin', color: { argb: INK } } };
    });
  };
  const title = (ws: WS, text: string, span: number) => {
    ws.mergeCells(1, 1, 1, span);
    const c = ws.getCell(1, 1);
    c.value = text;
    c.font = { size: 16, bold: true, color: { argb: INK } };
    ws.mergeCells(2, 1, 2, span);
    const sub = ws.getCell(2, 1);
    sub.value = `${periodName(period)}: ${period.label}`;
    sub.font = { italic: true, color: { argb: 'FF8A8277' } };
  };

  /* ---- Summary ---- */
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 28 }, { width: 20 }, { width: 18 }, { width: 6 }, { width: 24 }, { width: 14 }, { width: 18 }];
  title(sum, `${STORE_NAME} — Sales Report`, 7);
  sum.getCell('A3').value = `Generated ${new Date().toLocaleString()} by ${generatedBy}`;
  sum.getCell('A3').font = { size: 9, color: { argb: 'FF8A8277' } };

  const kpis: [string, number, boolean][] = [
    ['Total revenue', s.revenue, true],
    ['Transactions', s.transactions, false],
    ['Items sold', s.items, false],
    ['Average sale', s.average, true],
    ['Discounts given', s.discounts, true],
    ['Cost of goods sold', s.cost, true],
    ['Gross profit', s.profit, true],
  ];
  sum.getRow(5).values = ['Key figures', 'Value'];
  headerRow(sum, 5);
  kpis.forEach(([k, v, money], i) => {
    const r = sum.getRow(6 + i);
    r.values = [k, v];
    if (money) r.getCell(2).numFmt = PESO;
    if (k === 'Total revenue' || k === 'Gross profit') {
      r.getCell(1).font = { bold: true };
      r.getCell(2).font = { bold: true, color: { argb: ACCENT } };
    }
  });
  const marginRow = sum.getRow(6 + kpis.length);
  marginRow.values = ['Gross margin', s.revenue ? s.profit / s.revenue : 0];
  marginRow.getCell(2).numFmt = '0.0%';

  // payment methods (E..G)
  sum.getCell('E5').value = 'Payment method';
  sum.getCell('F5').value = 'Sales';
  sum.getCell('G5').value = 'Total';
  ['E5', 'F5', 'G5'].forEach((a) => {
    const c = sum.getCell(a);
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  });
  s.byMethod.forEach((m, i) => {
    sum.getCell(6 + i, 5).value = methodLabel(m.method);
    sum.getCell(6 + i, 6).value = m.count;
    sum.getCell(6 + i, 7).value = m.total;
    sum.getCell(6 + i, 7).numFmt = PESO;
  });

  // cashiers
  const cStart = Math.max(6 + s.byMethod.length + 2, 16);
  sum.getCell(cStart, 5).value = 'Cashier';
  sum.getCell(cStart, 6).value = 'Sales';
  sum.getCell(cStart, 7).value = 'Total';
  [5, 6, 7].forEach((col) => {
    const c = sum.getCell(cStart, col);
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  });
  s.byCashier.forEach((c, i) => {
    sum.getCell(cStart + 1 + i, 5).value = c.name;
    sum.getCell(cStart + 1 + i, 6).value = c.count;
    sum.getCell(cStart + 1 + i, 7).value = c.total;
    sum.getCell(cStart + 1 + i, 7).numFmt = PESO;
  });

  /* ---- Breakdown ---- */
  const bd = wb.addWorksheet(period.type === 'day' ? 'By hour' : period.type === 'year' ? 'By month' : 'By day', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  bd.columns = [{ width: 16 }, { width: 14 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 16 }];
  title(bd, `${STORE_NAME} — ${period.type === 'day' ? 'Hourly' : period.type === 'year' ? 'Monthly' : 'Daily'} breakdown`, 6);
  bd.getRow(4).values = [period.type === 'day' ? 'Hour' : period.type === 'year' ? 'Month' : 'Day', 'Transactions', 'Items', 'Revenue', 'Discounts', 'Gross profit'];
  headerRow(bd, 4);
  s.breakdown.forEach((b, i) => {
    const r = bd.getRow(5 + i);
    r.values = [b.label, b.count, b.items, b.revenue, b.discount, b.profit];
    [4, 5, 6].forEach((c) => (r.getCell(c).numFmt = PESO));
    if (i % 2) r.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } }));
  });
  const bt = 5 + s.breakdown.length;
  bd.getRow(bt).values = ['Total', s.transactions, s.items, s.revenue, s.discounts, s.profit];
  [4, 5, 6].forEach((c) => (bd.getRow(bt).getCell(c).numFmt = PESO));
  totalRow(bd, bt);

  /* ---- Transactions ---- */
  const tx = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 4 }] });
  tx.columns = [
    { width: 18 }, { width: 13 }, { width: 10 }, { width: 22 }, { width: 12 },
    { width: 8 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 12 },
    { width: 28 }, { width: 20 },
  ];
  title(tx, `${STORE_NAME} — Transactions`, 13);
  tx.getRow(4).values = ['Receipt', 'Date', 'Time', 'Cashier', 'Payment', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Change', 'Account', 'Reference'];
  headerRow(tx, 4);
  [...sales]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((sale, i) => {
      const d = new Date(sale.created_at);
      const r = tx.getRow(5 + i);
      r.values = [
        sale.receipt_no,
        d.toLocaleDateString(),
        d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        takenBy(sale),
        methodLabel(sale.payment_method),
        (sale.sale_items ?? []).reduce((a, it) => a + it.quantity, 0),
        Number(sale.subtotal),
        Number(sale.discount),
        Number(sale.total),
        Number(sale.amount_paid),
        Number(sale.change_due),
        sale.payment_account ?? '',
        sale.payment_ref ?? '',
      ];
      [7, 8, 9, 10, 11].forEach((c) => (r.getCell(c).numFmt = PESO));
    });
  if (sales.length) {
    tx.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + sales.length, column: 13 } };
    const tr = 5 + sales.length;
    tx.getRow(tr).values = ['Total', '', '', '', '', s.items, s.revenue + s.discounts, s.discounts, s.revenue];
    [7, 8, 9].forEach((c) => (tx.getRow(tr).getCell(c).numFmt = PESO));
    totalRow(tx, tr);
  }

  /* ---- Items sold ---- */
  const it = wb.addWorksheet('Items sold', { views: [{ state: 'frozen', ySplit: 4 }] });
  it.columns = [{ width: 36 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 10 }];
  title(it, `${STORE_NAME} — Items sold`, 6);
  it.getRow(4).values = ['Product', 'Qty', 'Revenue', 'Cost', 'Gross profit', 'Margin'];
  headerRow(it, 4);
  s.byProduct.forEach((p, i) => {
    const r = it.getRow(5 + i);
    r.values = [p.name, p.qty, p.revenue, p.cost, p.profit, p.revenue ? p.profit / p.revenue : 0];
    [3, 4, 5].forEach((c) => (r.getCell(c).numFmt = PESO));
    r.getCell(6).numFmt = '0.0%';
  });
  if (s.byProduct.length) {
    const ir = 5 + s.byProduct.length;
    it.getRow(ir).values = ['Total', s.items, s.byProduct.reduce((a, p) => a + p.revenue, 0), s.cost, s.byProduct.reduce((a, p) => a + p.profit, 0)];
    [3, 4, 5].forEach((c) => (it.getRow(ir).getCell(c).numFmt = PESO));
    totalRow(it, ir);
  }

  /* ---- Ingredients (food menu) ---- */
  if (usage.length) {
    const ig = wb.addWorksheet('Ingredients', { views: [{ state: 'frozen', ySplit: 4 }] });
    ig.columns = [{ width: 30 }, { width: 8 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 12 }];
    title(ig, `${STORE_NAME} — Ingredients used`, 8);
    ig.getRow(4).values = ['Ingredient', 'Unit', 'Used', 'Used value', 'Wasted', 'Waste value', 'Restocked', 'In stock now'];
    headerRow(ig, 4);
    usage.forEach((u, i) => {
      const r = ig.getRow(5 + i);
      r.values = [u.name, u.unit, u.used, u.used * u.cost, u.wasted, u.wasted * u.cost, u.restocked, u.stock];
      [4, 6].forEach((c) => (r.getCell(c).numFmt = PESO));
    });
    const tr = 5 + usage.length;
    ig.getRow(tr).values = ['Total', '', '', usage.reduce((a, u) => a + u.used * u.cost, 0), '', usage.reduce((a, u) => a + u.wasted * u.cost, 0)];
    [4, 6].forEach((c) => (ig.getRow(tr).getCell(c).numFmt = PESO));
    totalRow(ig, tr);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${STORE_NAME.replace(/\s+/g, '')}_Sales_${period.type}_${period.fileLabel}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const periodName = (p: Period) => ({ day: 'Daily report', week: 'Weekly report', month: 'Monthly report', year: 'Yearly report' })[p.type];
