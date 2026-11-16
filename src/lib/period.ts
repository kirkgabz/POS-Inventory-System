export type PeriodType = 'day' | 'week' | 'month' | 'year';

export interface Period {
  type: PeriodType;
  start: Date; // inclusive
  end: Date; // exclusive
  label: string;
  fileLabel: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Period containing `anchor`, shifted by `offset` periods (-1 = previous). Weeks start Monday. */
export function getPeriod(type: PeriodType, offset = 0, anchor = new Date()): Period {
  const a = new Date(anchor);
  a.setHours(0, 0, 0, 0);
  let start: Date, end: Date, label: string, fileLabel: string;

  switch (type) {
    case 'day': {
      start = new Date(a);
      start.setDate(start.getDate() + offset);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      label = start.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
      fileLabel = ymd(start);
      break;
    }
    case 'week': {
      start = new Date(a);
      const dow = (start.getDay() + 6) % 7; // Monday = 0
      start.setDate(start.getDate() - dow + offset * 7);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      const last = new Date(end);
      last.setDate(last.getDate() - 1);
      const mon = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
      label =
        start.getMonth() === last.getMonth()
          ? `${mon(start)} ${start.getDate()} – ${last.getDate()}, ${last.getFullYear()}`
          : `${mon(start)} ${start.getDate()} – ${mon(last)} ${last.getDate()}, ${last.getFullYear()}`;
      fileLabel = `week-of-${ymd(start)}`;
      break;
    }
    case 'month': {
      start = new Date(a.getFullYear(), a.getMonth() + offset, 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      label = start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      fileLabel = `${start.getFullYear()}-${pad(start.getMonth() + 1)}`;
      break;
    }
    case 'year': {
      start = new Date(a.getFullYear() + offset, 0, 1);
      end = new Date(start.getFullYear() + 1, 0, 1);
      label = String(start.getFullYear());
      fileLabel = label;
      break;
    }
  }
  return { type, start, end, label, fileLabel };
}

/** Buckets used for the breakdown chart/sheet. */
export function buckets(p: Period): { key: string; label: string; start: Date; end: Date }[] {
  const out: { key: string; label: string; start: Date; end: Date }[] = [];
  if (p.type === 'day') {
    for (let h = 0; h < 24; h++) {
      const s = new Date(p.start);
      s.setHours(h);
      const e = new Date(s);
      e.setHours(h + 1);
      out.push({ key: String(h), label: s.toLocaleTimeString(undefined, { hour: 'numeric' }), start: s, end: e });
    }
  } else if (p.type === 'year') {
    for (let m = 0; m < 12; m++) {
      const s = new Date(p.start.getFullYear(), m, 1);
      out.push({ key: String(m), label: s.toLocaleDateString(undefined, { month: 'short' }), start: s, end: new Date(p.start.getFullYear(), m + 1, 1) });
    }
  } else {
    for (let d = new Date(p.start); d < p.end; d.setDate(d.getDate() + 1)) {
      const s = new Date(d);
      const e = new Date(d);
      e.setDate(e.getDate() + 1);
      out.push({
        key: ymd(s),
        label: p.type === 'week' ? s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : String(s.getDate()),
        start: s,
        end: e,
      });
    }
  }
  return out;
}
