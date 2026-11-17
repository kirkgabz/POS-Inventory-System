import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, ImagePlus, Loader2, MessageSquareText, Printer, Receipt, Save, Settings2, Trash2 } from 'lucide-react';
import { supabase, errorMessage } from '../lib/supabase';
import { confirmAction, failure, success } from '../lib/alerts';
import { STORE_NAME } from '../lib/format';
import { uploadReceiptLogo } from '../lib/storage';
import { DEFAULT_RECEIPT, SAMPLE_RECEIPT, getReceiptSettings, printReceipt, receiptHtml, setReceiptCache, type ReceiptSettings } from '../lib/receipt';

export default function ReceiptSettingsPage() {
  const [saved, setSaved] = useState<ReceiptSettings | null>(null);
  const [form, setForm] = useState<ReceiptSettings>(DEFAULT_RECEIPT);
  const [logoFile, setLogoFile] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getReceiptSettings(true).then((s) => {
      setSaved(s);
      setForm(s);
    });
  }, []);

  const set = <K extends keyof ReceiptSettings>(k: K, v: ReceiptSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = useMemo(() => !!saved && (JSON.stringify(saved) !== JSON.stringify(form) || !!logoFile), [saved, form, logoFile]);

  const previewSettings = { ...form, logo_url: logoFile?.url ?? form.logo_url };
  const preview = useMemo(() => receiptHtml(SAMPLE_RECEIPT, previewSettings), [JSON.stringify(previewSettings)]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const ok = await confirmAction({
      title: 'Save receipt details?',
      html: 'All new receipts and reprints will use these details.',
      confirmText: 'Save',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const logo_url = logoFile ? await uploadReceiptLogo(logoFile.file) : form.logo_url;
      const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
      const row = {
        ...form,
        logo_url,
        business_name: clean(form.business_name),
        tagline: clean(form.tagline),
        address: clean(form.address),
        phone: clean(form.phone),
        email: clean(form.email),
        tin: clean(form.tin),
        business_permit: clean(form.business_permit),
        header_note: clean(form.header_note),
        footer_message: clean(form.footer_message),
        vat_rate: Number(form.vat_rate) || 12,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('receipt_settings').update(row).eq('id', 1);
      if (error) throw error;
      const next = { ...row } as ReceiptSettings;
      delete (next as Partial<{ updated_at: string }>).updated_at;
      setReceiptCache(next);
      setSaved(next);
      setForm(next);
      setLogoFile(null);
      success('Receipt updated', 'New receipts will use these details.');
    } catch (err) {
      failure('Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const testPrint = async () => {
    if (dirty) {
      const ok = await confirmAction({ title: 'Print with unsaved changes?', text: 'The test print uses your saved details. Save first to print the changes.', confirmText: 'Print saved version' });
      if (!ok) return;
    }
    const opened = await printReceipt({ ...SAMPLE_RECEIPT, at: new Date().toISOString() });
    if (!opened) failure('Pop-up blocked', 'Allow pop-ups for this site to print receipts.');
  };

  const removeLogo = async () => {
    if (!(await confirmAction({ title: 'Remove the logo?', text: 'Receipts will show only the business name.', confirmText: 'Remove', danger: true }))) return;
    setLogoFile(null);
    set('logo_url', null);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Store owner</span>
          <h1 className="display">Receipt &amp; invoice</h1>
        </div>
        <div className="row gap-sm">
          <button className="btn btn-ghost" onClick={testPrint}>
            <Printer size={16} /> Test print
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Save changes
          </button>
        </div>
      </header>

      {!saved ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : (
        <div className="rcpt">
          <div className="rcpt-form">
            <Section icon={<Building2 size={17} />} title="Business" hint="Shown at the top of every receipt">
              <div className="rcpt-logo">
                <div className="rcpt-logo-box">
                  {logoFile?.url || form.logo_url ? <img src={logoFile?.url ?? form.logo_url!} alt="Logo" /> : <ImagePlus size={22} strokeWidth={1.4} />}
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <label className="btn btn-ghost btn-sm" htmlFor="logo-input">
                    <ImagePlus size={14} /> {form.logo_url || logoFile ? 'Change logo' : 'Upload logo'}
                  </label>
                  {(form.logo_url || logoFile) && (
                    <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={removeLogo}>
                      <Trash2 size={14} /> Remove
                    </button>
                  )}
                  <small className="muted">Black &amp; white logos print best.</small>
                </div>
                <input
                  id="logo-input"
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setLogoFile({ file: f, url: URL.createObjectURL(f) });
                    e.target.value = '';
                  }}
                />
              </div>
              <Field label="Business name">
                <input className="input" value={form.business_name ?? ''} onChange={(e) => set('business_name', e.target.value)} placeholder={STORE_NAME} />
              </Field>
              <Field label="Tagline">
                <input className="input" value={form.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} placeholder="e.g. Your neighborhood store" />
              </Field>
              <Field label="Address">
                <textarea className="input" rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Street, Barangay, City, Province" />
              </Field>
              <div className="grid-2">
                <Field label="Contact number">
                  <input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="0917 123 4567" />
                </Field>
                <Field label="Email">
                  <input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="store@email.com" />
                </Field>
              </div>
            </Section>

            <Section icon={<Receipt size={17} />} title="Tax & registration" hint="For BIR-registered businesses">
              <div className="grid-2">
                <Field label="TIN">
                  <input className="input mono" value={form.tin ?? ''} onChange={(e) => set('tin', e.target.value)} placeholder="000-000-000-00000" />
                </Field>
                <Field label="Business permit no.">
                  <input className="input mono" value={form.business_permit ?? ''} onChange={(e) => set('business_permit', e.target.value)} placeholder="Optional" />
                </Field>
              </div>
              <label className="switch rcpt-switch">
                <input type="checkbox" checked={form.vat_registered} onChange={(e) => set('vat_registered', e.target.checked)} />
                <i />
                <span>
                  <b>VAT-registered</b> — prices include VAT; the receipt shows VATable sales and VAT.
                </span>
              </label>
              {form.vat_registered && (
                <Field label="VAT rate (%)">
                  <input className="input" type="number" min={0} max={30} step="0.5" value={form.vat_rate} onChange={(e) => set('vat_rate', Number(e.target.value))} style={{ maxWidth: 140 }} />
                </Field>
              )}
            </Section>

            <Section icon={<MessageSquareText size={17} />} title="Messages">
              <Field label="Header note" hint="Under the store details, e.g. opening hours or promo">
                <textarea className="input" rows={2} value={form.header_note ?? ''} onChange={(e) => set('header_note', e.target.value)} placeholder="Open daily 8:00 AM – 9:00 PM" />
              </Field>
              <Field label="Footer message">
                <textarea className="input" rows={2} value={form.footer_message ?? ''} onChange={(e) => set('footer_message', e.target.value)} placeholder="Thank you, come again!" />
              </Field>
            </Section>

            <Section icon={<Settings2 size={17} />} title="Layout & options">
              <Field label="Paper size">
                <div className="seg seg-3">
                  {(['58mm', '80mm', 'A4'] as const).map((p) => (
                    <button key={p} type="button" className={form.paper_width === p ? 'on' : ''} onClick={() => set('paper_width', p)}>
                      {p === 'A4' ? 'A4 / Letter' : `${p} thermal`}
                    </button>
                  ))}
                  <i className="seg-pill" style={{ transform: `translateX(${['58mm', '80mm', 'A4'].indexOf(form.paper_width) * 100}%)` }} />
                </div>
              </Field>
              <div className="rcpt-toggles">
                <Toggle checked={form.show_cashier} onChange={(v) => set('show_cashier', v)} label="Show cashier name" />
                <Toggle checked={form.show_barcode} onChange={(v) => set('show_barcode', v)} label="Receipt number barcode" />
                <Toggle checked={form.show_not_official} onChange={(v) => set('show_not_official', v)} label='"This is not an official receipt"' />
              </div>
              {!form.show_not_official && (
                <p className="note">
                  <span>
                    Only turn this off if your receipts are BIR-registered (accredited POS / CAS). Otherwise keep the notice and issue official receipts separately.
                  </span>
                </p>
              )}
            </Section>
          </div>

          <aside className="rcpt-preview">
            <div className="rcpt-preview-head">
              <span className="eyebrow">Live preview</span>
              {dirty && <span className="tag">unsaved</span>}
            </div>
            <div className={`rcpt-paper p-${form.paper_width.toLowerCase()}`}>
              <iframe title="Receipt preview" srcDoc={preview} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card rcpt-sec">
      <header className="rcpt-sec-head">
        <span className="rcpt-sec-icon">{icon}</span>
        <div>
          <h3 className="display">{title}</h3>
          {hint && <span className="muted small">{hint}</span>}
        </div>
      </header>
      <div className="stack">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <small className="muted">— {hint}</small>}
      </span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
      <span className="small">{label}</span>
    </label>
  );
}
