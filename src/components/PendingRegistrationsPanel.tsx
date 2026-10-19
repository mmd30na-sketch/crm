import React, { useEffect, useMemo, useState } from 'react';
import ModalPortal from './ModalPortal';
import { ClipboardCheck, RefreshCw, Eye, CheckCircle, XCircle, ExternalLink, ImageOff, X, ChevronDown } from 'lucide-react';
import { useIsDesktop } from './FilterSheet';
import * as api from '../api/client';
import { WebsiteRegistration } from '../types';

/** Key read by StudentRegistrationForm to preselect a website registration when the register tab opens. */
export const OPEN_REGISTRATION_KEY = 'crm_open_registration_id';

function faDate(v?: string) {
  if (!v) return '—';
  const d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

type DocKind = 'personal_photo' | 'national_card';
const DOC_LABEL: Record<DocKind, string> = { personal_photo: 'عکس', national_card: 'کارت ملی' };

/** Loads a site document through the authenticated CRM route; click opens it larger. */
function DocThumb({ r, kind, onOpen }: { r: WebsiteRegistration; kind: DocKind; onOpen: (url: string, title: string) => void }) {
  const stored = kind === 'personal_photo' ? r.personal_photo_path : r.national_card_path;
  const [url, setUrl] = useState<string | null | undefined>(stored ? undefined : null);
  useEffect(() => {
    if (!stored || !r.tracking_code) return;
    let alive = true; let made: string | null = null;
    api.fetchRegistrationFileUrl(r.tracking_code, kind).then(u => { made = u; if (alive) setUrl(u); else if (u) URL.revokeObjectURL(u); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [r.tracking_code, kind, stored]);
  const label = DOC_LABEL[kind];
  if (url === undefined) return <div className="w-10 h-10 rounded-lg bg-slate-100 animate-pulse" title={label} />;
  if (!url) return <div className="w-10 h-10 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300" title={`${label}: ارسال نشده`}><ImageOff className="w-4 h-4" /></div>;
  return (
    <button type="button" onClick={() => onOpen(url, `${label} — ${r.full_name || r.tracking_code}`)} title={label}
      className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 hover:ring-2 hover:ring-violet-300 cursor-zoom-in shrink-0">
      <img src={url} alt={label} className="w-full h-full object-cover" />
    </button>
  );
}

export default function PendingRegistrationsPanel({ onActiveTabChange }: { onActiveTabChange: (tab: string) => void }) {
  const [rows, setRows] = useState<WebsiteRegistration[] | null>(null);
  const [reviews, setReviews] = useState<Record<string, api.RegistrationReview>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [preview]);

  const load = () => {
    setError(null);
    Promise.all([api.fetchRegistrations(), api.fetchRegistrationReviews().catch(() => ({}))])
      .then(([regs, rv]) => { setRows(regs.filter(r => r.status === 'pending' && !r.student_id)); setReviews(rv); })
      .catch(() => { setRows([]); setError('خواندن ثبت‌نام‌های سایت ممکن نشد.'); });
  };
  useEffect(load, []);

  const list = useMemo(() => (rows || []).filter(r => showReviewed || !reviews[r.tracking_code]), [rows, reviews, showReviewed]);
  const unreviewed = (rows || []).filter(r => !reviews[r.tracking_code]).length;

  // Mobile (<1024px): accordion, collapsed by default. Desktop always open.
  const isDesktop = useIsDesktop();
  const [expanded, setExpanded] = useState(false);
  const open = isDesktop || expanded;

  const openRecord = (r: WebsiteRegistration) => {
    try { sessionStorage.setItem(OPEN_REGISTRATION_KEY, String(r.id)); } catch { /* storage blocked */ }
    onActiveTabChange('register');
  };
  const markReviewed = async (r: WebsiteRegistration, reviewed: boolean) => {
    setBusy(r.tracking_code); setError(null);
    try {
      const rv = await api.setRegistrationReviewed(r.tracking_code, reviewed);
      setReviews(rv);
    } catch (e: any) { setError(e?.message || 'ثبت وضعیت بررسی ناموفق بود.'); }
    finally { setBusy(null); }
  };
  const reject = async (r: WebsiteRegistration) => {
    if (!window.confirm(`ثبت‌نام «${r.full_name || r.tracking_code}» رد شود؟`)) return;
    setBusy(r.tracking_code); setError(null);
    try { await api.rejectRegistration(r.tracking_code); setRows(rs => (rs || []).filter(x => x.id !== r.id)); }
    catch (e: any) { setError(e?.message || 'رد ثبت‌نام ناموفق بود.'); }
    finally { setBusy(null); }
  };

  return (
    <div dir="rtl" className="mb-5 bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
      {!isDesktop && (
        <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} aria-controls="pending-registrations-body"
          className={`w-full min-h-11 flex items-center justify-between gap-2 text-right cursor-pointer ${expanded ? 'border-b border-slate-100 pb-3 mb-3' : ''}`}>
          <span className="text-sm font-bold text-slate-900 flex items-center gap-2 min-w-0">
            <ClipboardCheck className="w-4 h-4 text-violet-600 shrink-0" /><span className="truncate">ثبت‌نام‌های در انتظار بررسی</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-600 text-white shrink-0">{unreviewed.toLocaleString('fa-IR')}</span>
          </span>
          <ChevronDown className={`w-5 h-5 text-slate-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && <div id="pending-registrations-body">
      <div className={`flex items-center justify-between gap-2 flex-wrap ${isDesktop ? 'border-b border-slate-100 pb-3 mb-3' : 'mb-3'}`}>
        {isDesktop && <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-violet-600" />ثبت‌نام‌های سایت در انتظار بررسی
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200">{unreviewed} بررسی‌نشده</span>
        </h3>}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showReviewed} onChange={e => setShowReviewed(e.target.checked)} />نمایش بررسی‌شده‌ها
          </label>
          <button type="button" onClick={load} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer" title="به‌روزرسانی"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>
      {error && <div role="alert" className="mb-2 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-md">{error}</div>}
      {rows === null ? <div className="text-xs text-slate-400 py-4 text-center">در حال بارگذاری...</div>
        : list.length === 0 ? <div className="text-xs text-slate-400 py-4 text-center">ثبت‌نام بررسی‌نشده‌ای وجود ندارد.</div>
        : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs text-right">
              <thead><tr className="text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="p-2 font-semibold">مدارک</th><th className="p-2 font-semibold">نام</th><th className="p-2 font-semibold">موبایل</th>
                <th className="p-2 font-semibold">تاریخ</th><th className="p-2 font-semibold">دوره / نوع</th>
                <th className="p-2 font-semibold">وضعیت</th><th className="p-2 font-semibold text-center">عملیات</th>
              </tr></thead>
              <tbody>
                {list.map(r => {
                  const rv = reviews[r.tracking_code];
                  const b = busy === r.tracking_code;
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/40 transition align-middle">
                      <td className="p-2"><div className="flex gap-1.5"><DocThumb r={r} kind="personal_photo" onOpen={(url, title) => setPreview({ url, title })} /><DocThumb r={r} kind="national_card" onOpen={(url, title) => setPreview({ url, title })} /></div></td>
                      <td className="p-2 font-bold text-slate-800">{r.full_name || 'بدون نام'}<div className="text-[10px] font-normal text-slate-400"><bdi dir="ltr" className="font-mono">{r.tracking_code}</bdi></div></td>
                      <td className="p-2"><bdi dir="ltr" className="font-mono text-slate-600">{r.phone_number}</bdi></td>
                      <td className="p-2 text-slate-600 whitespace-nowrap">{faDate(r.created_at)}</td>
                      <td className="p-2 text-slate-700">{r.category || '—'}</td>
                      <td className="p-2">{rv
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200" title={rv.by ? `توسط ${rv.by}` : ''}>بررسی‌شده</span>
                        : <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">در انتظار</span>}</td>
                      <td className="p-2">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          <button type="button" disabled={b} onClick={() => markReviewed(r, !rv)} className="px-2 py-1 rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-50 inline-flex items-center gap-1 font-bold cursor-pointer"><Eye className="w-3.5 h-3.5" />{rv ? 'لغو بررسی' : 'بررسی شد'}</button>
                          <button type="button" disabled={b} onClick={() => openRecord(r)} title="تأیید نیاز به انتخاب دوره دارد؛ فرم ثبت‌نام با همین اطلاعات باز می‌شود" className="px-2 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 inline-flex items-center gap-1 font-bold cursor-pointer"><CheckCircle className="w-3.5 h-3.5" />تأیید</button>
                          <button type="button" disabled={b} onClick={() => reject(r)} className="px-2 py-1 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 inline-flex items-center gap-1 font-bold cursor-pointer"><XCircle className="w-3.5 h-3.5" />رد</button>
                          <button type="button" onClick={() => openRecord(r)} className="px-2 py-1 rounded-lg text-violet-700 hover:bg-violet-50 inline-flex items-center gap-1 font-bold cursor-pointer"><ExternalLink className="w-3.5 h-3.5" />باز کردن</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>}
      {preview && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4" onClick={() => setPreview(null)} role="dialog" aria-label={preview.title}>
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 mb-2 text-white text-xs font-bold">
              <span className="truncate">{preview.title}</span>
              <span className="flex items-center gap-2 shrink-0">
                <a href={preview.url} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" />تب جدید</a>
                <button type="button" onClick={() => setPreview(null)} className="p-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer" aria-label="بستن"><X className="w-4 h-4" /></button>
              </span>
            </div>
            <img src={preview.url} alt={preview.title} className="w-full max-h-[80vh] object-contain rounded-xl bg-white" />
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}
