import type { Attendance } from './types';
import { STORE_NAME } from './format';

export const hoursOf = (a: Pick<Attendance, 'time_in' | 'time_out'>, now = Date.now()) =>
  Math.max(0, ((a.time_out ? new Date(a.time_out).getTime() : now) - new Date(a.time_in).getTime()) / 3600000);

export const fmtHours = (h: number) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

const methodText = (m: string | null) => (m === 'face' ? 'Face' : m === 'owner' ? 'Owner' : m === 'manual' ? 'Manual' : '');

/** Excel DTR: a Summary sheet (per person) and a full Time log sheet. */
export async function downloadAttendanceExcel(rows: Attendance[], periodLabel: string, fileLabel: string, timeZone: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = STORE_NAME;
  const t = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone }) : '—';
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
    ws.getCell(2, 1).value = periodLabel;
    ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF7C8089' } };
  };

  // Summary
  const per = new Map<string, { name: string; days: Set<string>; hours: number; open: number }>();
  rows.forEach((r) => {
    const k = r.user_id;
    const g = per.get(k) ?? { name: r.person?.full_name ?? 'Unknown', days: new Set<string>(), hours: 0, open: 0 };
    g.days.add(r.work_date);
    g.hours += r.time_out ? hoursOf(r) : 0;
    if (!r.time_out) g.open++;
    per.set(k, g);
  });
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 28 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 16 }];
  title(sum, `${STORE_NAME} — Daily Time Record`, 5);
  sum.getRow(4).values = ['Staff', 'Days', 'Total hours', 'Avg hours/day', 'Not timed out'];
  head(sum, 4);
  [...per.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((g, i) => {
      const r = sum.getRow(5 + i);
      r.values = [g.name, g.days.size, Math.round(g.hours * 100) / 100, g.days.size ? Math.round((g.hours / g.days.size) * 100) / 100 : 0, g.open];
      r.getCell(3).numFmt = '0.00';
      r.getCell(4).numFmt = '0.00';
    });

  // Log
  const log = wb.addWorksheet('Time log', { views: [{ state: 'frozen', ySplit: 4 }] });
  log.columns = [{ width: 26 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 30 }];
  title(log, `${STORE_NAME} — Time log`, 8);
  log.getRow(4).values = ['Staff', 'Date', 'Time in', 'Time out', 'Hours', 'In via', 'Out via', 'Note'];
  head(log, 4);
  [...rows]
    .sort((a, b) => a.time_in.localeCompare(b.time_in))
    .forEach((a, i) => {
      const r = log.getRow(5 + i);
      r.values = [
        a.person?.full_name ?? 'Unknown',
        a.work_date,
        t(a.time_in),
        t(a.time_out),
        a.time_out ? Math.round(hoursOf(a) * 100) / 100 : '',
        methodText(a.method_in),
        methodText(a.method_out),
        a.note ?? '',
      ];
      r.getCell(5).numFmt = '0.00';
    });
  if (rows.length) log.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: 8 } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${STORE_NAME.replace(/\s+/g, '')}_DTR_${fileLabel}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
