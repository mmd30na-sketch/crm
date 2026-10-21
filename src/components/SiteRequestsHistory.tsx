import React, { useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, Search, UserPlus, Check } from 'lucide-react';
import * as api from '../api/client';
import { listLeads, createLead, listLeadSources } from '../api/phase4';
import { Course, WebsiteRegistration } from '../types';

/** Website category -> CRM course id (same map as StudentRegistrationForm) and a Persian fallback label. */
const CATEGORY: Record<string, { id: number; label: string }> = {
  cargo_freight: { id: 1, label: 'رانندگی حمل بار' },
  hazardous_materials: { id: 2, label: 'حمل مواد خطرناک' },
  passenger_bus: { id: 3, label: 'رانندگی مسافربری' },
  passenger_transport: { id: 3, label: 'رانندگی مسافربری' },
  ceo_company: { id: 4, label: 'مدیر شرکت حمل‌ونقل' },
  ceo_freight: { id: 4, label: 'مدیر شرکت حمل‌ونقل' },
  ceo_passenger: { id: 5, label: 'مدیر شرکت مسافربری' },
  technical_manager: { id: 6, label: 'مسئول فنی' },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'در انتظار', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'تأیید‌شده', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'رد‌شده', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** MySQL datetimes are UTC; show them as Jalali in Tehran time. */
function faDate(v?: string | null) {
  if (!v) return '—';
  const s = String(v).replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const toLatin = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
const phoneKey = (v: unknown) => { const d = toLatin(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

export default function SiteRequestsHistory({ courses }: { courses: Course[] }) {
  const [rows, setRows] = useState<WebsiteRegistration[] | null>(null);
  const [leadPhones, setLeadPhones] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setError(null); setRows(null);
    Promise.all([api.fetchRegistrations(), listLeads().catch(() => [])])
      .then(([regs, leads]) => {
        setRows(regs);
        setLeadPhones(new Set(leads.map((l) => phoneKey(l.phone_number)).filter(Boolean)));
      })
      .catch(() => { setRows([]); setError('خواندن درخواست‌های سایت ممکن نشد.'); });
  };
  useEffect(load, []);

  const courseName = (cat?: string) => {
    const e = CATEGORY[String(cat || '')];
    if (!e) return cat || '—';
    return courses.find((c) => Number(c.id) === e.id)?.title || e.label;
  };

  const shown = useMemo(() => {
    const term = toLatin(q).trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return (rows || []).filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (!term) return true;
      return (r.full_name || '').toLowerCase().includes(term)
        || (r.tracking_code || '').toLowerCase().includes(term)
        || (digits.length >= 3 && (toLatin(r.phone_number).includes(digits) || toLatin(r.national_code).includes(digits)));
    });
  }, [rows, q, status]);

  const addLead = async (r: WebsiteRegistration) => {
    const key = phoneKey(r.phone_number);
    if (!key || leadPhones.has(key)) return;
    const parts = String(r.full_name || '').trim().split(/\s+/).filter(Boolean);
    setBusy(r.tracking_code); setError(null);
    try {
      // Re-check right before creating, so a lead added meanwhile (another tab/user) is not duplicated.
      const fresh = await listLeads();
      if (fresh.some((l) => phoneKey(l.phone_number) === key)) { setLeadPhones((s) => new Set(s).add(key)); return; }
      const websiteSource = (await listLeadSources().catch(() => [])).find((x) => x.code === 'website');
      await createLead({
        first_name: parts.length > 1 ? parts[0] : null,
        last_name: parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] || r.tracking_code),
        phone_number: `0${key}`,
        national_code: r.national_code || null,
        course_id: CATEGORY[String(r.category || '')]?.id ?? null,
        source_id: websiteSource?.id ?? null,
        status: 'new',
        notes: `ثبت‌نام سایت: ${r.tracking_code} (${STATUS[r.status]?.label || r.status})`,
      });
      setLeadPhones((s) => new Set(s).add(key));
    } catch (e: any) {
      setError(e?.message || 'افزودن به سرنخ‌ها ناموفق بود.');
    } finally { setBusy(null); }
  };

  const inputCls = 'h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400';

  return (
    <section dir="rtl" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <History className="h-5 w-5 text-violet-600" />
        <h2 className="text-base font-bold text-slate-800">تاریخچه درخواست‌های سایت</h2>
        <span className="text-xs text-slate-500">{rows ? `${shown.length} از ${rows.length}` : ''}</span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، کد پیگیری، موبایل" className={`${inputCls} w-56 pr-8`} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="all">همه وضعیت‌ها</option>
          <option value="pending">در انتظار</option>
          <option value="approved">تأیید‌شده</option>
          <option value="rejected">رد‌شده</option>
        </select>
        <button type="button" onClick={load} className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> بروزرسانی
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-rose-700">{error}</p>}
      {!rows ? (
        <p className="py-10 text-center text-sm text-slate-400">در حال بارگذاری...</p>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">درخواستی پیدا نشد.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-right text-xs text-slate-500">
                <th className="p-2">تاریخ ثبت</th><th className="p-2">کد پیگیری</th><th className="p-2">نام</th><th className="p-2">موبایل</th>
                <th className="p-2">دوره</th><th className="p-2">وضعیت</th><th className="p-2">تاریخ تأیید/رد</th><th className="p-2">پرداخت آنلاین</th><th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = STATUS[r.status] || { label: r.status, cls: 'bg-slate-50 text-slate-600 border-slate-200' };
                const inLeads = leadPhones.has(phoneKey(r.phone_number));
                return (
                  <tr key={r.tracking_code || r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="p-2 whitespace-nowrap text-slate-600">{faDate(r.created_at)}</td>
                    <td className="p-2"><bdi dir="ltr" className="font-mono text-xs">{r.tracking_code}</bdi></td>
                    <td className="p-2 font-medium text-slate-800">{r.full_name || '—'}</td>
                    <td className="p-2"><bdi dir="ltr" className="font-mono text-slate-600">{r.phone_number}</bdi></td>
                    <td className="p-2 text-slate-600">{courseName(r.category)}</td>
                    <td className="p-2"><span className={`rounded-full border px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span></td>
                    <td className="p-2 whitespace-nowrap text-slate-600">{r.status === 'pending' ? '—' : faDate(r.approved_at)}</td>
                    <td className="p-2 text-xs">{r.paid_toman ? <span className="text-emerald-700">{r.paid_toman.toLocaleString('fa-IR')} تومان</span> : r.paid_toman === 0 ? <span className="text-slate-400">پرداخت نشده</span> : '—'}</td>
                    <td className="p-2 text-left">
                      <button type="button" disabled={inLeads || busy !== null || !phoneKey(r.phone_number)} onClick={() => void addLead(r)}
                        className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold ${inLeads ? 'bg-slate-100 text-slate-500' : 'bg-violet-600 text-white hover:bg-violet-700'} disabled:cursor-not-allowed disabled:opacity-70`}>
                        {inLeads ? <><Check className="h-3.5 w-3.5" /> در سرنخ‌ها هست</> : <><UserPlus className="h-3.5 w-3.5" /> {busy === r.tracking_code ? 'در حال افزودن...' : 'افزودن به سرنخ‌ها'}</>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
