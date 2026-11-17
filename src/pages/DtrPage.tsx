import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Hand,
  LogIn,
  LogOut,
  Pencil,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Timer,
  UserRoundCheck,
} from 'lucide-react';
import FaceScanner from '../components/FaceScanner';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { initials } from '../lib/format';
import { getPeriod, type PeriodType } from '../lib/period';
import { downloadAttendanceExcel, fmtHours, hoursOf } from '../lib/attendanceReport';
import type { Attendance, DtrStatus, Profile } from '../lib/types';

type ScanPurpose = 'enroll' | 'in' | 'out';

export default function DtrPage() {
  const { profile, isAdmin } = useAuth();
  const [status, setStatus] = useState<DtrStatus | null>(null);
  const [offset, setOffset] = useState(0); // server - device clock (ms)
  const [now, setNow] = useState(Date.now());
  const [scan, setScan] = useState<ScanPurpose | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Attendance[]>([]);
  const [version, setVersion] = useState(0);

  const tz = status?.timezone ?? 'Asia/Manila';
  const fmtTime = useCallback((iso: string | number, seconds = false) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined, timeZone: tz }), [tz]);
  const fmtDay = useCallback((iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }), [tz]);

  const load = useCallback(async () => {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('dtr_status');
    if (error) return failure('Could not load the time clock', errorMessage(error));
    const s = data as DtrStatus;
    setOffset(new Date(s.server_now).getTime() - (t0 + Date.now()) / 2);
    setStatus(s);
    const { data: rows } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', profile!.id)
      .order('time_in', { ascending: false })
      .limit(31);
    setMine((rows as Attendance[]) ?? []);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load, version]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // live updates (e.g. the owner closes my shift)
  useEffect(() => {
    const ch = supabase
      .channel(`dtr-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => setVersion((v) => v + 1))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const serverNow = now + offset;
  const open = status?.open ?? null;

  /* ---------- actions ---------- */
  const punch = async (kind: 'in' | 'out', descriptor: number[] | null) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(kind === 'in' ? 'clock_in' : 'clock_out', { p_descriptor: descriptor });
    setBusy(false);
    if (error) return failure(kind === 'in' ? 'Could not time in' : 'Could not time out', errorMessage(error));
    const row = data as Attendance;
    setVersion((v) => v + 1);
    success(
      kind === 'in' ? 'Timed in' : 'Timed out',
      kind === 'in'
        ? `${fmtTime(row.time_in)}${row.method_in === 'face' ? ' · face verified' : ''}`
        : `${fmtTime(row.time_out!)} · ${fmtHours(hoursOf(row))} today`,
      2200,
    );
  };

  const start = async (kind: 'in' | 'out', useFace: boolean) => {
    if (!status) return;
    if (useFace) {
      if (!status.enrolled) return setScan('enroll');
      return setScan(kind);
    }
    const ok = await confirmAction({
      title: kind === 'in' ? 'Time in now?' : 'Time out now?',
      html: `<div class="sw-summary big"><span>${kind === 'in' ? 'Time in' : 'Time out'}</span><b>${fmtTime(serverNow)}</b></div>${
        kind === 'out' && open ? `<div class="sw-summary"><span>Worked</span><span>${fmtHours(hoursOf(open, serverNow))}</span></div>` : ''
      }`,
      confirmText: kind === 'in' ? 'Time in' : 'Time out',
      danger: kind === 'out',
    });
    if (ok) punch(kind, null);
  };

  const onScan = async (descriptor: number[]) => {
    const purpose = scan;
    setScan(null);
    if (purpose === 'enroll') {
      const ok = await confirmAction({
        title: 'Save this face?',
        html: 'This face will be used to verify you when you time in and out.<br/><small>Only the store owner can reset it later.</small>',
        confirmText: 'Save my face',
      });
      if (!ok) return;
      const { error } = await supabase.rpc('enroll_face', { p_descriptor: descriptor });
      if (error) return failure('Could not save your face', errorMessage(error));
      await load();
      success('Face ID ready', 'You can now time in with your face.');
      return;
    }
    if (purpose === 'in' || purpose === 'out') punch(purpose, descriptor);
  };

  /* ---------- my history ---------- */
  const weekStart = useMemo(() => getPeriod('week', 0).start.getTime(), []);
  const weekHours = mine.filter((a) => new Date(a.time_in).getTime() >= weekStart).reduce((s, a) => s + hoursOf(a, serverNow), 0);
  const staleOpen = open && new Date(open.time_in).toDateString() !== new Date(serverNow).toDateString();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Daily time record</span>
          <h1 className="display">Time clock</h1>
        </div>
      </header>

      <div className="dtr-hero">
        <section className={`card dtr-clock ${open ? 'is-in' : ''}`}>
          <span className="eyebrow">{new Date(serverNow).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })}</span>
          <div className="dtr-time display">{fmtTime(serverNow, true)}</div>

          {!status ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : (
            <>
              <div className="dtr-state">
                <span className={`dtr-dot ${open ? 'on' : ''}`} />
                {open ? (
                  <span>
                    On the clock since <b>{fmtTime(open.time_in)}</b>
                    {staleOpen && <em className="dtr-warn"> · started {fmtDay(open.time_in)}</em>}
                  </span>
                ) : (
                  <span>You're off the clock</span>
                )}
              </div>
              {open && (
                <div className="dtr-elapsed">
                  <Timer size={16} /> {fmtHours(hoursOf(open, serverNow))}
                </div>
              )}

              <div className="dtr-actions">
                {status.face_required ? (
                  <button className={`dtr-btn ${open ? 'out' : 'in'}`} disabled={busy} onClick={() => start(open ? 'out' : 'in', true)}>
                    <ScanFace size={22} />
                    <span>{open ? 'Time out' : 'Time in'}</span>
                    <small>with face</small>
                  </button>
                ) : (
                  <>
                    <button className={`dtr-btn ${open ? 'out' : 'in'}`} disabled={busy} onClick={() => start(open ? 'out' : 'in', false)}>
                      {open ? <LogOut size={22} /> : <LogIn size={22} />}
                      <span>{open ? 'Time out' : 'Time in'}</span>
                    </button>
                    {status.enrolled && (
                      <button className="btn btn-ghost dtr-alt" disabled={busy} onClick={() => start(open ? 'out' : 'in', true)}>
                        <ScanFace size={15} /> Use face instead
                      </button>
                    )}
                  </>
                )}
              </div>

              <p className="dtr-rule">
                {status.face_required ? (
                  <>
                    <ShieldCheck size={14} /> The store owner requires <b>live face verification</b>.
                  </>
                ) : (
                  <>
                    <Hand size={14} /> Manual time in/out is allowed. The time is taken from the server clock.
                  </>
                )}
              </p>
            </>
          )}
        </section>

        <section className="card dtr-side">
          <div className="dtr-face">
            <span className={`dtr-face-icon ${status?.enrolled ? 'ok' : ''}`}>
              <ScanFace size={22} />
            </span>
            <div className="grow">
              <strong>Face ID</strong>
              <div className="muted small">
                {status?.enrolled ? 'Set up — you can time in with your face.' : status?.face_required ? 'Required — set it up before your first time in.' : 'Optional — faster and proves it was you.'}
              </div>
            </div>
            {status && !status.enrolled && (
              <button className="btn btn-primary btn-sm" onClick={() => setScan('enroll')}>
                Set up
              </button>
            )}
          </div>
          <div className="dtr-week">
            <span className="eyebrow">This week</span>
            <b className="display">{fmtHours(weekHours)}</b>
          </div>
          <div className="dtr-mini">
            {mine.slice(0, 6).map((a) => (
              <div key={a.id}>
                <span>{fmtDay(a.time_in)}</span>
                <span className="muted">
                  {fmtTime(a.time_in)} – {a.time_out ? fmtTime(a.time_out) : 'now'}
                </span>
                <b>{fmtHours(hoursOf(a, serverNow))}</b>
              </div>
            ))}
            {mine.length === 0 && <p className="muted small">No records yet.</p>}
          </div>
        </section>
      </div>

      {isAdmin && <OwnerPanel tz={tz} serverNow={serverNow} faceRequired={!!status?.face_required} threshold={status?.threshold ?? 0.5} onSettings={load} />}

      {scan && (
        <FaceScanner
          mode={scan === 'enroll' ? 'enroll' : 'verify'}
          title={scan === 'enroll' ? 'Set up Face ID' : scan === 'in' ? 'Time in' : 'Time out'}
          subtitle={scan === 'enroll' ? 'Look straight at the camera in good light.' : `Verifying ${profile?.full_name ?? 'you'}`}
          onResult={onScan}
          onCancel={() => setScan(null)}
        />
      )}
    </div>
  );
}

/* =================================================================== */

function OwnerPanel({ tz, serverNow, faceRequired, threshold, onSettings }: { tz: string; serverNow: number; faceRequired: boolean; threshold: number; onSettings: () => void }) {
  const [type, setType] = useState<PeriodType>('day');
  const [off, setOff] = useState(0);
  const [rows, setRows] = useState<Attendance[]>([]);
  const [openNow, setOpenNow] = useState<Attendance[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [enrolled, setEnrolled] = useState<Record<string, string>>({});
  const [who, setWho] = useState('');
  const [editing, setEditing] = useState<Attendance | null>(null);
  const [v, setV] = useState(0);
  const period = useMemo(() => getPeriod(type, off), [type, off]);

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });

  useEffect(() => {
    const sel = '*, person:profiles!attendance_user_id_fkey(full_name, email)';
    Promise.all([
      supabase.from('attendance').select(sel).gte('time_in', period.start.toISOString()).lt('time_in', period.end.toISOString()).order('time_in', { ascending: false }).limit(2000),
      supabase.from('attendance').select(sel).is('time_out', null).order('time_in'),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.rpc('face_enrollments'),
    ]).then(([a, o, p, f]) => {
      setRows((a.data as Attendance[]) ?? []);
      setOpenNow((o.data as Attendance[]) ?? []);
      setPeople((p.data as Profile[]) ?? []);
      setEnrolled(Object.fromEntries(((f.data as { user_id: string; enrolled_at: string }[]) ?? []).map((x) => [x.user_id, x.enrolled_at])));
    });
  }, [period, v]);

  useEffect(() => {
    const ch = supabase
      .channel(`dtr-owner-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => setV((x) => x + 1))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const shown = who ? rows.filter((r) => r.user_id === who) : rows;
  const total = shown.reduce((s, r) => s + (r.time_out ? hoursOf(r) : 0), 0);

  const setSetting = async (patch: { dtr_face_required?: boolean; dtr_face_threshold?: number }, confirm: { title: string; html: string; confirmText: string; danger?: boolean }, done: string) => {
    if (!(await confirmAction(confirm))) return;
    const { error } = await supabase.from('app_settings').update(patch).eq('id', 1);
    if (error) return failure('Could not save', errorMessage(error));
    onSettings();
    success(done);
  };

  const resetFace = async (p: Profile) => {
    const ok = await confirmAction({
      title: 'Reset Face ID?',
      html: `<b>${p.full_name}</b> will need to set up their face again before using face time in.`,
      confirmText: 'Reset',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('reset_face', { p_user: p.id });
    if (error) return failure('Could not reset', errorMessage(error));
    setV((x) => x + 1);
    success('Face ID reset', p.full_name);
  };

  const exportExcel = async () => {
    const ok = await confirmAction({
      title: 'Download DTR?',
      html: `<b>${period.label}</b><br/>${shown.length} record(s)${who ? ` · ${people.find((p) => p.id === who)?.full_name}` : ''}`,
      confirmText: 'Download',
    });
    if (!ok) return;
    try {
      await downloadAttendanceExcel(shown, period.label, `${period.type}_${period.fileLabel}`, tz);
      success('DTR downloaded', 'Check your Downloads folder.');
    } catch (e) {
      failure('Could not create the file', errorMessage(e));
    }
  };

  return (
    <>
      <div className="dtr-owner-grid">
        <section className="card">
          <header className="card-head">
            <div>
              <span className="eyebrow">Store owner · setting</span>
              <h3 className="display">Face verification</h3>
            </div>
            <ShieldCheck size={18} className="muted" />
          </header>
          <label className="switch dtr-switch">
            <input
              type="checkbox"
              checked={faceRequired}
              onChange={() =>
                setSetting(
                  { dtr_face_required: !faceRequired },
                  faceRequired
                    ? { title: 'Allow manual time in?', html: 'Staff will be able to time in and out with a button. Face verification stays optional.', confirmText: 'Allow manual', danger: true }
                    : { title: 'Require live face verification?', html: 'Staff must pass a live face scan (with a blink check) to time in and out.<br/><small>Staff without Face ID will be asked to set it up first.</small>', confirmText: 'Require face' },
                  faceRequired ? 'Manual time in allowed' : 'Face verification required',
                )
              }
            />
            <i />
            <span>
              <b>{faceRequired ? 'Required' : 'Optional'}</b> — {faceRequired ? 'staff must scan their face to time in/out.' : 'staff can use the manual button.'}
            </span>
          </label>
          <div className="field" style={{ marginTop: 14 }}>
            <span className="small muted">Match strictness</span>
            <div className="seg seg-3">
              {[
                { v: 0.55, l: 'Relaxed' },
                { v: 0.5, l: 'Normal' },
                { v: 0.42, l: 'Strict' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={Math.abs(threshold - o.v) < 0.001 ? 'on' : ''}
                  onClick={() =>
                    Math.abs(threshold - o.v) > 0.001 &&
                    setSetting({ dtr_face_threshold: o.v }, { title: `Use ${o.l.toLowerCase()} matching?`, html: o.v < 0.5 ? 'Fewer false matches, but staff may need better light.' : o.v > 0.5 ? 'Easier to pass, slightly less secure.' : 'Recommended balance.', confirmText: `Use ${o.l}` }, 'Strictness saved')
                  }
                >
                  {o.l}
                </button>
              ))}
              <i className="seg-pill" style={{ transform: `translateX(${[0.55, 0.5, 0.42].findIndex((x) => Math.abs(threshold - x) < 0.001) * 100}%)` }} />
            </div>
          </div>
        </section>

        <section className="card">
          <header className="card-head">
            <div>
              <span className="eyebrow">Live</span>
              <h3 className="display">On the clock now · {openNow.length}</h3>
            </div>
            <UserRoundCheck size={18} className="muted" />
          </header>
          {openNow.length === 0 ? (
            <p className="muted small">Nobody is timed in right now.</p>
          ) : (
            <ul className="list">
              {openNow.map((a) => (
                <li key={a.id}>
                  <span className="dtr-person">
                    <span className="avatar">{initials(a.person?.full_name ?? '?')}</span>
                    <span>
                      <strong>{a.person?.full_name}</strong>
                      <span className="muted small"> · since {fmtTime(a.time_in)}{a.method_in === 'face' && ' · face'}</span>
                    </span>
                  </span>
                  <b>{fmtHours(hoursOf(a, serverNow))}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <header className="card-head wrap-head">
          <div>
            <span className="eyebrow">Attendance</span>
            <h3 className="display">
              Time log <span className="muted">· {fmtHours(total)}</span>
            </h3>
          </div>
          <div className="row gap-sm wrap">
            <select className="input select-sm" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" onClick={exportExcel}>
              <FileSpreadsheet size={14} /> Excel
            </button>
          </div>
        </header>

        <div className="period-bar" style={{ marginBottom: 14 }}>
          <div className="tabs no-margin">
            {(['day', 'week', 'month'] as PeriodType[]).map((t) => (
              <button key={t} className={`tab ${type === t ? 'on' : ''}`} onClick={() => (setType(t), setOff(0))}>
                {{ day: 'Day', week: 'Week', month: 'Month', year: 'Year' }[t]}
              </button>
            ))}
          </div>
          <div className="period-nav">
            <button className="icon-btn" onClick={() => setOff((o) => o - 1)} aria-label="Previous">
              <ChevronLeft size={18} />
            </button>
            <strong className="display period-label">{period.label}</strong>
            <button className="icon-btn" onClick={() => setOff((o) => Math.min(0, o + 1))} disabled={off >= 0} aria-label="Next">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            <Clock3 size={32} strokeWidth={1.2} />
            <p>No time records in this period.</p>
          </div>
        ) : (
          <div className="table-wrap flat">
            <table className="table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Date</th>
                  <th>In</th>
                  <th>Out</th>
                  <th className="num">Hours</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.person?.full_name}</strong>
                      {a.note && <div className="muted small">{a.note}</div>}
                    </td>
                    <td className="small">{fmtDay(a.time_in)}</td>
                    <td>
                      {fmtTime(a.time_in)} <MethodTag m={a.method_in} />
                    </td>
                    <td>
                      {a.time_out ? (
                        <>
                          {fmtTime(a.time_out)} <MethodTag m={a.method_out} />
                        </>
                      ) : (
                        <span className="tag dtr-open">on the clock</span>
                      )}
                    </td>
                    <td className="num">{fmtHours(hoursOf(a, serverNow))}</td>
                    <td className="actions">
                      <button className="icon-btn" title="Correct" onClick={() => setEditing(a)}>
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">Biometrics</span>
            <h3 className="display">Face ID enrolment</h3>
          </div>
          <ScanFace size={18} className="muted" />
        </header>
        <div className="people">
          {people
            .filter((p) => p.is_active)
            .map((p) => (
              <div key={p.id} className="person">
                <span className="avatar">{initials(p.full_name)}</span>
                <div className="grow">
                  <strong>{p.full_name}</strong>
                  <div className="muted small">{enrolled[p.id] ? `Enrolled ${new Date(enrolled[p.id]!).toLocaleDateString()}` : 'Not set up yet'}</div>
                </div>
                <span className={`tag ${enrolled[p.id] ? 'dtr-enrolled' : ''}`}>{enrolled[p.id] ? 'Face ID on' : 'No Face ID'}</span>
                {enrolled[p.id] && (
                  <button className="btn btn-ghost btn-xs danger-text" onClick={() => resetFace(p)}>
                    <RotateCcw size={13} /> Reset
                  </button>
                )}
              </div>
            ))}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Face data is stored as numbers only (no photos) and can't be viewed by anyone. Reset it if a staff member's face changes or they set it up wrongly.
        </p>
      </section>

      <EditShift row={editing} tz={tz} onClose={() => setEditing(null)} onSaved={() => setV((x) => x + 1)} />
    </>
  );
}

function MethodTag({ m }: { m: string | null }) {
  if (!m) return null;
  return <span className={`dtr-m m-${m}`}>{m === 'face' ? 'face' : m === 'owner' ? 'owner' : 'manual'}</span>;
}

/** Owner correction: fix times (e.g. staff forgot to time out). */
function EditShift({ row, tz: _tz, onClose, onSaved }: { row: Attendance | null; tz: string; onClose: () => void; onSaved: () => void }) {
  const toLocal = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [tin, setTin] = useState('');
  const [tout, setTout] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!row) return;
    setTin(toLocal(row.time_in));
    setTout(toLocal(row.time_out));
    setNote(row.note ?? '');
  }, [row]);

  if (!row) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const inD = new Date(tin);
    const outD = tout ? new Date(tout) : null;
    if (outD && outD < inD) return failure('Check the times', 'Time out must be after time in.');
    const ok = await confirmAction({
      title: 'Save correction?',
      html: `<b>${row.person?.full_name ?? 'Staff'}</b><br/>${inD.toLocaleString()} → ${outD ? outD.toLocaleString() : 'still on the clock'}`,
      confirmText: 'Save correction',
    });
    if (!ok) return;
    const { data: me } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('attendance')
      .update({
        time_in: inD.toISOString(),
        time_out: outD ? outD.toISOString() : null,
        method_out: outD ? (row.time_out && row.method_out ? row.method_out : 'owner') : null,
        note: note.trim() || null,
        edited_by: me.user?.id ?? null,
      })
      .eq('id', row.id);
    if (error) return failure('Could not save', errorMessage(error));
    onSaved();
    onClose();
    success('Record corrected');
  };

  const remove = async () => {
    const ok = await confirmAction({ title: 'Delete this record?', text: 'This time record will be removed permanently.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('attendance').delete().eq('id', row.id);
    if (error) return failure('Could not delete', errorMessage(error));
    onSaved();
    onClose();
    success('Record deleted');
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Correct time record"
      subtitle={row.person?.full_name}
      footer={
        <>
          <button type="button" className="btn btn-ghost danger-text mr-auto" onClick={remove}>
            Delete
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button form="shift-form" className="btn btn-primary">
            Save
          </button>
        </>
      }
    >
      <form id="shift-form" className="stack" onSubmit={save}>
        <label className="field">
          <span>Time in</span>
          <input className="input" type="datetime-local" required value={tin} onChange={(e) => setTin(e.target.value)} />
        </label>
        <label className="field">
          <span>Time out {!row.time_out && <small className="muted">— set it if they forgot to time out</small>}</span>
          <input className="input" type="datetime-local" value={tout} onChange={(e) => setTout(e.target.value)} />
        </label>
        <label className="field">
          <span>Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Forgot to time out" />
        </label>
      </form>
    </Modal>
  );
}
