import React, { useEffect, useState } from 'react';
import * as api from '../../api/client';
import { DOC_KINDS, DOC_LABELS, DocData, buildDocData, docWarnings, DocKind } from '../../utils/printDocs';
import { jalaliToday } from '../../utils/normalize';
import { DocByKind, PD_CSS, fontFaceCss } from './PrintDocs';
import { printDoc, ensureDocStyles, renderDocPdf, downloadBlob } from './docService';
import RegistrationDocsPanel from './RegistrationDocsPanel';

const svg = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
const SAMPLE_PHOTO = svg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#dbeafe"/><circle cx="150" cy="150" r="70" fill="#94a3b8"/><path d="M40 400c0-90 50-130 110-130s110 40 110 130z" fill="#64748b"/></svg>');
const SAMPLE_CARD = svg('<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540"><rect width="856" height="540" rx="36" fill="#ecfeff" stroke="#0e7490" stroke-width="6"/><rect x="40" y="60" width="200" height="260" fill="#cbd5e1"/><g fill="#475569"><rect x="280" y="80" width="420" height="26"/><rect x="280" y="140" width="360" height="26"/><rect x="280" y="200" width="300" height="26"/><rect x="280" y="260" width="380" height="26"/></g><text x="428" y="470" font-size="30" text-anchor="middle" fill="#0e7490" font-family="sans-serif">SAMPLE - SYNTHETIC CARD</text></svg>');

/** Synthetic data for the design preview: never a real person. */
export function sampleDocData(withImages = true): DocData {
  return buildDocData({
    student: { first_name: 'سارا', last_name: 'نمونه‌زاده', national_code: '0000000000', phone_number: '09120000000', father_name: 'رضا' },
    enrollment: { id: 1234, course_number: 118, final_price: 4500000 },
    course: { title: 'آموزش رانندگی گواهینامه پایه سوم', tuition: 4500000 },
    paid: 3000000,
    settings: {
      academy_name: 'آموزشگاه رانندگی نمونه', phone_number: '08312345678', address: 'کرمانشاه، خیابان نمونه، پلاک ۱۰',
      header_text: 'مجوز شماره ۱۲۳۴ — نمونهٔ آزمایشی', footer_text: 'خواهشمند است پیش از آزمون نسبت به تسویه کامل اقدام فرمایید.',
    },
    images: withImages ? { personal: SAMPLE_PHOTO, nationalCard: SAMPLE_CARD } : {},
    date: '1405/07/18',
  });
}

const SCREEN_CSS = `
.pdv-wrap{min-height:100vh;background:#e2e8f0;padding:16px 16px 40px;font-family:'CarlaVazir',Tahoma,sans-serif}
.pdv-bar{max-width:900px;margin:0 auto 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;direction:rtl}
.pdv-bar button{padding:6px 12px;border-radius:8px;border:1px solid #0f766e;background:#0f766e;color:#fff;font:inherit;font-size:13px;cursor:pointer}
.pdv-bar button.alt{background:#fff;color:#0f766e}
.pdv-pages{display:flex;flex-wrap:wrap;gap:20px;justify-content:center}
.pdv-pages .pd-page{box-shadow:0 2px 12px rgba(15,23,42,.25)}
@media print{.pdv-wrap{background:#fff;padding:0}.pdv-bar,.pdv-side{display:none!important}.pdv-pages{display:block}.pdv-pages .pd-page{box-shadow:none;break-after:page;page-break-after:always;height:210mm}}
`;

/**
 * ?print=all            -> the three documents with synthetic sample data (no login needed), for design review
 * ?print=all&enrollment=ID -> the same pages with the real data of that enrollment (login required)
 */
export default function PrintPreview({ enrollmentId }: { enrollmentId?: number }) {
  const [data, setData] = useState<DocData | null>(enrollmentId ? null : sampleDocData());
  const [panelInput, setPanelInput] = useState<React.ComponentProps<typeof RegistrationDocsPanel> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void ensureDocStyles(); }, []);
  useEffect(() => {
    if (!enrollmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const ctx = await api.fetchEnrollmentDocContext(enrollmentId);
        if (!ctx.student) throw new Error('کارآموز این ثبت‌نام پیدا نشد.');
        const paid = ctx.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const input = {
          student: ctx.student, enrollment: { id: ctx.enrollment.id, course_number: ctx.enrollment.course_number ?? null, final_price: ctx.enrollment.final_price },
          course: ctx.course, paid, settings: ctx.settings,
          images: { personal: ctx.student.personal_photo_url, nationalCard: ctx.student.id_card_photo_url },
          date: ctx.enrollment.signup_date_jalali || jalaliToday(),
        };
        if (cancelled) return;
        setData(buildDocData(input));
        setPanelInput({
          input,
          existing: { Receipt: ctx.enrollment.receipt_pdf_path, IDCard: ctx.enrollment.idcard_pdf_path, Contract: ctx.enrollment.contract_pdf_path },
        });
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'بارگذاری ناموفق بود.');
      }
    })();
    return () => { cancelled = true; };
  }, [enrollmentId]);

  if (error) return <p role="alert" className="p-6 text-rose-700 text-sm">{error}</p>;
  if (!data) return <p className="p-6 text-slate-500 text-sm">در حال بارگذاری…</p>;
  const warnings = docWarnings(data);

  return (
    <div className="pdv-wrap" dir="rtl" data-testid="print-preview">
      <style>{fontFaceCss() + PD_CSS + SCREEN_CSS}</style>
      <div className="pdv-bar">
        <strong style={{ fontSize: 14 }}>{enrollmentId ? `پیش‌نمایش مدارک ثبت‌نام ${enrollmentId}` : 'پیش‌نمایش طراحی مدارک (داده نمونه)'}</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => window.print()}>چاپ هر سه (یک کار چاپ)</button>
          {DOC_KINDS.map((k: DocKind) => (
            <button key={k} type="button" className="alt" onClick={() => void printDoc(k, data)}>چاپ {DOC_LABELS[k]}</button>
          ))}
          {DOC_KINDS.map((k: DocKind) => (
            <button key={`pdf-${k}`} type="button" className="alt" data-pdf={k}
              onClick={() => void renderDocPdf(k, data).then((b) => downloadBlob(b, `preview_${k}.pdf`)).catch((e) => setError(String(e?.message || e)))}>PDF {DOC_LABELS[k]}</button>
          ))}
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="pdv-side" style={{ maxWidth: 900, margin: '0 auto 12px', fontSize: 12, color: '#92400e' }}>
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {panelInput && <div className="pdv-side" style={{ maxWidth: 900, margin: '0 auto 16px', background: '#fff', padding: 12, borderRadius: 12 }}><RegistrationDocsPanel {...panelInput} /></div>}
      <div className="pdv-pages">
        {DOC_KINDS.map((k) => <DocByKind key={k} kind={k} data={data} />)}
      </div>
    </div>
  );
}
