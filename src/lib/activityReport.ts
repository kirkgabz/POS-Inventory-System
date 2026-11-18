import type { ProductActivity } from './types';
import { STORE_NAME, roleName } from './format';

const LABEL: Record<string, string> = {
  added: 'Added product',
  restock: 'Restocked',
  stock_in: 'Stock added',
  stock_out: 'Stock removed',
  waste: 'Waste',
  price: 'Price change',
  edited: 'Edited',
  deleted: 'Deleted',
};

/** Excel inventory log: a per-person Summary sheet and the full Log sheet. */
export async function downloadActivityExcel(rows: ProductActivity[], label: string, describe: (a: ProductActivity) => string[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = STORE_NAME;

  const head = (ws: ReturnType<typeof wb.addWorksheet>, row: number) =>
    ws.getRow(row).eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141414' } };
    });
  const title = (ws: ReturnType<typeof wb.addWorksheet>, text: string, span: number) => {
    ws.mergeCells(1, 1, 1, span);
    ws.getCell(1, 1).value = text;
    ws.getCell(1, 1).font = { size: 15, bold: true };
    ws.mergeCells(2, 1, 2, span);
    ws.getCell(2, 1).value = label;
    ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF7C8089' } };
  };

  // Summary per person
  const per = new Map<string, { name: string; role: string; added: number; prices: number; edits: number; unitsIn: number; unitsOut: number }>();
  rows.forEach((r) => {
    const k = r.actor_id ?? r.actor_name;
    const g = per.get(k) ?? { name: r.actor_name, role: roleName(r.actor_role), added: 0, prices: 0, edits: 0, unitsIn: 0, unitsOut: 0 };
    if (r.action === 'added') {
      g.added++;
      g.unitsIn += Math.max(0, r.stock_change ?? 0);
    } else if (r.action === 'price') g.prices++;
    else if (r.action === 'edited' || r.action === 'deleted') g.edits++;
    else if (r.action === 'stock_out' || r.action === 'waste') g.unitsOut += Math.abs(r.stock_change ?? 0);
    else g.unitsIn += r.stock_change ?? 0;
    per.set(k, g);
  });

  const sum = wb.addWorksheet('Summary');
  title(sum, `${STORE_NAME} — Inventory log`, 7);
  sum.addRow([]);
  sum.addRow(['Person', 'Role', 'Products added', 'Units stocked in', 'Price changes', 'Edits', 'Units removed']);
  head(sum, 4);
  [...per.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((g) => sum.addRow([g.name, g.role, g.added, g.unitsIn, g.prices, g.edits, g.unitsOut]));
  sum.columns.forEach((c, i) => (c.width = i < 2 ? 24 : 16));

  // Full log
  const log = wb.addWorksheet('Log');
  title(log, 'Every change', 7);
  log.addRow([]);
  log.addRow(['Date', 'Time', 'Person', 'Role', 'Action', 'Product', 'Details']);
  head(log, 4);
  rows.forEach((r) => {
    const d = new Date(r.created_at);
    log.addRow([
      d.toLocaleDateString(),
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      r.actor_name,
      roleName(r.actor_role),
      LABEL[r.action] ?? r.action,
      r.product_name,
      describe(r).join('; '),
    ]);
  });
  [12, 10, 22, 12, 16, 30, 60].forEach((w, i) => (log.getColumn(i + 1).width = w));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${STORE_NAME}-inventory-log-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
