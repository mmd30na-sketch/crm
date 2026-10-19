import React from 'react';
import arabic400 from '@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2';
import arabic700 from '@fontsource/vazirmatn/files/vazirmatn-arabic-700-normal.woff2';
import latin400 from '@fontsource/vazirmatn/files/vazirmatn-latin-400-normal.woff2';
import latin700 from '@fontsource/vazirmatn/files/vazirmatn-latin-700-normal.woff2';
import { DocData, DocKind, formatAmount, toPersianDigits } from '../../utils/printDocs';

/**
 * The three registration documents, each one A5 portrait page (148 x 210 mm), RTL, designed in HTML/CSS.
 * They are pure functions of a plain DocData object, so the same markup is used for the on-screen preview,
 * the browser print dialog (hidden iframe) and the PDF files (html2canvas -> jsPDF, see docService.ts).
 */

export const PAGE_MM = { width: 148, height: 210 } as const;

/** @font-face rules for the self-hosted Vazirmatn (bundled by Vite, no CDN). `base` resolves relative asset URLs for iframes. */
export function fontFaceCss(base: string = typeof window !== 'undefined' ? window.location.href : 'http://localhost/'): string {
  const abs = (u: string) => new URL(u, base).href;
  const face = (file: string, weight: number, range: string) =>
    `@font-face{font-family:'CarlaVazir';font-style:normal;font-weight:${weight};font-display:block;src:url(${abs(file)}) format('woff2');unicode-range:${range};}`;
  const latin = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const arabic = 'U+0600-06FF,U+0750-077F,U+200C-200F,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFC';
  // Latin first, Arabic second: the later face wins for the overlapping zero-width/format characters.
  return [face(latin400, 400, latin), face(latin700, 700, latin), face(arabic400, 400, arabic), face(arabic700, 700, arabic)].join('');
}

export const PD_CSS = `
.pd-page{box-sizing:border-box;width:148mm;min-height:210mm;padding:8mm 9mm 7mm;background:#fff;color:#111827;
  font-family:'CarlaVazir','Vazirmatn',Tahoma,sans-serif;font-size:10.5pt;line-height:1.7;direction:rtl;text-align:right;
  display:flex;flex-direction:column;position:relative;overflow:hidden;-webkit-font-smoothing:antialiased}
.pd-page *{box-sizing:border-box}
.pd-receipt,.pd-summary{height:210mm}
.pd-frame{position:absolute;inset:4mm;border:0.35mm solid #0f172a;border-radius:2mm;pointer-events:none}
.pd-frame::after{content:'';position:absolute;inset:1mm;border:0.15mm solid #94a3b8;border-radius:1.4mm}
.pd-head{display:flex;align-items:center;gap:4mm;padding-bottom:3mm;border-bottom:0.5mm solid #0f766e}
.pd-logo{width:15mm;height:15mm;object-fit:contain;flex:none}
.pd-logo-fallback{width:15mm;height:15mm;flex:none;border:0.4mm solid #0f766e;border-radius:3mm;display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:15pt;color:#0f766e}
.pd-brand{flex:1;min-width:0}
.pd-brand-name{font-size:14pt;font-weight:700;line-height:1.35}
.pd-brand-sub{font-size:8.5pt;color:#475569}
.pd-title{margin:3mm 0 3mm;text-align:center;font-size:15pt;font-weight:700;letter-spacing:0}
.pd-title small{display:block;font-size:8.5pt;font-weight:400;color:#64748b;margin-top:0.5mm}
.pd-meta{display:grid;grid-template-columns:repeat(3,1fr);border:0.3mm solid #334155;border-radius:1.5mm;overflow:hidden;margin-bottom:3.5mm}
.pd-meta>div{padding:1.4mm 2.5mm;border-left:0.3mm solid #334155}
.pd-meta>div:last-child{border-left:0}
.pd-meta span{display:block;font-size:7.5pt;color:#64748b;line-height:1.4}
.pd-meta b{font-size:11pt;font-weight:700}
.pd-rows{width:100%;border-collapse:collapse}
.pd-rows th,.pd-rows td{padding:1.5mm 2.5mm;border-bottom:0.2mm solid #cbd5e1;vertical-align:top}
.pd-rows th{width:34%;font-weight:400;color:#475569;font-size:9pt;white-space:nowrap}
.pd-rows td{font-weight:700}
.pd-num{direction:ltr;unicode-bidi:isolate;display:inline-block}
.pd-note{margin:3.5mm 0 0;font-size:9pt;color:#334155;line-height:1.9}
.pd-spacer{flex:1}
.pd-sign{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:5mm}
.pd-sign>div{border:0.3mm dashed #64748b;border-radius:1.5mm;height:27mm;padding:1.5mm 2.5mm;font-size:8.5pt;color:#475569;text-align:center}
.pd-foot{margin-top:4mm;padding-top:2mm;border-top:0.2mm solid #cbd5e1;font-size:8pt;color:#475569;text-align:center;line-height:1.7}
.pd-fin{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;margin:3mm 0 2mm}
.pd-fin>div{border:0.25mm solid #cbd5e1;border-radius:1.5mm;padding:1.2mm 2mm;text-align:center}
.pd-fin span{display:block;font-size:7.5pt;color:#64748b}
.pd-fin b{font-size:10pt}
.pd-fin .ok{background:#ecfdf5;border-color:#6ee7b7;color:#065f46}
.pd-fin .due{background:#fff7ed;border-color:#fdba74;color:#9a3412}
.pd-top{display:flex;gap:4mm;align-items:flex-start}
.pd-top .pd-rows{flex:1}
.pd-photo{width:30mm;height:40mm;flex:none;border:0.3mm solid #334155;border-radius:1mm;overflow:hidden;background:#f8fafc;display:flex;align-items:center;justify-content:center;
  text-align:center;font-size:7.5pt;color:#64748b;line-height:1.5}
.pd-photo img{width:100%;height:100%;object-fit:cover;display:block}
.pd-photo.empty{border-style:dashed}
.pd-card-label{margin:2mm 0 1.5mm;font-size:9pt;font-weight:700;color:#0f766e}
.pd-card{width:85.6mm;height:54mm;margin:0 auto;border:0.3mm solid #334155;border-radius:3mm;overflow:hidden;background:#f8fafc;display:flex;align-items:center;justify-content:center;
  font-size:8pt;color:#64748b;text-align:center}
.pd-card img{width:100%;height:100%;object-fit:contain;display:block}
.pd-card.empty{border-style:dashed}
.pd-clauses{margin:0;padding:0;list-style:none;counter-reset:c}
.pd-clauses li{counter-increment:c;position:relative;padding-right:6mm;margin-bottom:1.6mm;font-size:9.3pt;line-height:1.85;text-align:justify}
.pd-clauses li::before{content:attr(data-n);position:absolute;right:0;top:0;font-weight:700;color:#0f766e}
.pd-compact .pd-clauses li{font-size:8.2pt;line-height:1.7;margin-bottom:1mm}
.pd-intro{font-size:9.5pt;line-height:1.95;text-align:justify;margin:0 0 3mm}
.pd-intro b{font-weight:700}
.pd-h{font-size:9.5pt;font-weight:700;margin:3mm 0 1.5mm;color:#0f766e}
@page{size:148mm 210mm;margin:0}
`;

const Head: React.FC<{ d: DocData }> = ({ d }) => (
  <>
    <div className="pd-frame" />
    <div className="pd-head">
      {d.academy.logoUrl
        ? <img className="pd-logo" src={d.academy.logoUrl} alt="" />
        : <div className="pd-logo-fallback" aria-hidden="true">{d.academy.name.trim().charAt(0) || 'آ'}</div>}
      <div className="pd-brand">
        <div className="pd-brand-name">{d.academy.name}</div>
        {d.academy.header && <div className="pd-brand-sub">{d.academy.header}</div>}
      </div>
    </div>
  </>
);

const Num: React.FC<{ v: string | number }> = ({ v }) => <span className="pd-num">{toPersianDigits(v)}</span>;

const Meta: React.FC<{ d: DocData; cells?: Array<'receipt' | 'course' | 'date'> }> = ({ d, cells = ['receipt', 'course', 'date'] }) => (
  <div className="pd-meta" style={{ gridTemplateColumns: `repeat(${cells.length},1fr)` }}>
    {cells.map((c) => c === 'receipt'
      ? <div key={c}><span>شماره رسید</span><b>{d.receiptNumber ? <Num v={d.receiptNumber} /> : '—'}</b></div>
      : c === 'course'
        ? <div key={c}><span>شماره دوره</span><b>{d.courseNumber ? <Num v={d.courseNumber} /> : '—'}</b></div>
        : <div key={c}><span>تاریخ</span><b><Num v={d.date} /></b></div>)}
  </div>
);

const Foot: React.FC<{ d: DocData; text?: string }> = ({ d, text }) => {
  const contact = [d.academy.address, d.academy.phone ? `تلفن: ${toPersianDigits(d.academy.phone)}` : ''].filter(Boolean).join(' — ');
  const body = text ?? d.academy.footer;
  if (!body && !contact) return null;
  return <div className="pd-foot">{body && <div>{body}</div>}{contact && <div>{contact}</div>}</div>;
};

/** رسید ثبت‌نام — no amounts (like the old Access receipt). */
export const ReceiptDoc: React.FC<{ data: DocData }> = ({ data: d }) => (
  <div className="pd-page pd-receipt" dir="rtl" data-doc="Receipt">
    <Head d={d} />
    <div className="pd-title">رسید ثبت‌نام</div>
    <Meta d={d} />
    <table className="pd-rows"><tbody>
      <tr><th>نام</th><td>{d.student.firstName || '—'}</td></tr>
      <tr><th>نام خانوادگی</th><td>{d.student.lastName || '—'}</td></tr>
      <tr><th>کد ملی</th><td>{d.student.nationalCode ? <Num v={d.student.nationalCode} /> : '—'}</td></tr>
      <tr><th>شماره همراه</th><td>{d.student.mobile ? <Num v={d.student.mobile} /> : '—'}</td></tr>
      <tr><th>عنوان دوره</th><td>{d.courseTitle || '—'}</td></tr>
    </tbody></table>
    <p className="pd-note">
      ثبت‌نام کارآموز فوق در دوره یادشده در تاریخ <Num v={d.date} /> در این آموزشگاه انجام شد. این رسید را تا پایان دوره نزد خود نگه دارید.
    </p>
    <div className="pd-spacer" />
    <div className="pd-sign">
      <div>مهر و امضای آموزشگاه</div>
      <div>امضای کارآموز</div>
    </div>
    <Foot d={d} />
  </div>
);

/** برگ خلاصه پرونده (IDCard): data + 3x4 photo + a framed copy of the national card. */
export const FileSummaryDoc: React.FC<{ data: DocData }> = ({ data: d }) => (
  <div className="pd-page pd-summary" dir="rtl" data-doc="IDCard">
    <Head d={d} />
    <div className="pd-title">برگ خلاصه پرونده کارآموز</div>
    <Meta d={d} />
    <div className="pd-top">
      <table className="pd-rows"><tbody>
        <tr><th>نام و نام خانوادگی</th><td>{d.student.fullName || '—'}</td></tr>
        <tr><th>کد ملی</th><td>{d.student.nationalCode ? <Num v={d.student.nationalCode} /> : '—'}</td></tr>
        <tr><th>شماره همراه</th><td>{d.student.mobile ? <Num v={d.student.mobile} /> : '—'}</td></tr>
        <tr><th>عنوان دوره</th><td>{d.courseTitle || '—'}</td></tr>
      </tbody></table>
      <div className={`pd-photo${d.images.personal ? '' : ' empty'}`}>
        {d.images.personal ? <img src={d.images.personal} alt="عکس پرسنلی" /> : <span>محل عکس<br />۳×۴</span>}
      </div>
    </div>
    <div className="pd-fin">
      <div><span>شهریه</span><b><Num v={formatAmount(d.money.tuition)} /> <small>تومان</small></b></div>
      <div><span>پرداخت‌شده</span><b><Num v={formatAmount(d.money.paid)} /> <small>تومان</small></b></div>
      <div className={d.money.settled ? 'ok' : 'due'}><span>وضعیت</span><b>{d.money.settled ? 'تسویه کامل' : <>مانده <Num v={formatAmount(d.money.remaining)} /></>}</b></div>
    </div>
    <div className="pd-card-label">تصویر کارت ملی</div>
    <div className={`pd-card${d.images.nationalCard ? '' : ' empty'}`}>
      {d.images.nationalCard ? <img src={d.images.nationalCard} alt="کارت ملی" /> : <span>محل الصاق تصویر کارت ملی</span>}
    </div>
    <div className="pd-spacer" />
    <Foot d={d} />
  </div>
);

/** قرارداد آموزشی — clauses come from the editable contract text in the settings. */
export const ContractDoc: React.FC<{ data: DocData }> = ({ data: d }) => {
  const long = d.contractClauses.join('').length > 1300;
  return (
    <div className={`pd-page pd-contract${long ? ' pd-compact' : ''}`} dir="rtl" data-doc="Contract">
      <Head d={d} />
      <div className="pd-title">قرارداد آموزشی</div>
      <Meta d={d} />
      <p className="pd-intro">
        این قرارداد میان «<b>{d.academy.name}</b>» و کارآموز «<b>{d.student.fullName || '……………'}</b>»
        به کد ملی <b>{d.student.nationalCode ? <Num v={d.student.nationalCode} /> : '……………'}</b> برای دوره
        «<b>{d.courseTitle || '……………'}</b>» با شهریه <b><Num v={formatAmount(d.money.tuition)} /> تومان</b> منعقد می‌شود
        (پرداخت‌شده تا این تاریخ: <b><Num v={formatAmount(d.money.paid)} /> تومان</b>).
      </p>
      <div className="pd-h">شرایط و تعهدات</div>
      <ol className="pd-clauses">
        {d.contractClauses.map((c, i) => <li key={i} data-n={`${toPersianDigits(i + 1)}.`}>{c}</li>)}
      </ol>
      <div className="pd-spacer" />
      <div className="pd-sign">
        <div>مهر و امضای آموزشگاه</div>
        <div>امضا و اثرانگشت کارآموز<br /><span style={{ fontSize: '7.5pt' }}>(با قبول شرایط فوق)</span></div>
      </div>
      <Foot d={d} text="" />
    </div>
  );
};

export const DocByKind: React.FC<{ kind: DocKind; data: DocData }> = ({ kind, data }) =>
  kind === 'Receipt' ? <ReceiptDoc data={data} /> : kind === 'IDCard' ? <FileSummaryDoc data={data} /> : <ContractDoc data={data} />;
