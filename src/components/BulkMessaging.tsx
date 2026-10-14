import React, { useEffect, useState } from 'react';
import { Megaphone, Eye, PlayCircle, ShieldAlert, RefreshCw, X, Ban } from 'lucide-react';
import * as p4 from '../api/phase4';
import { Course } from '../types';
import ModalPortal from './ModalPortal';

const ROUTE_LABEL: Record<string, string> = { account: 'اکانت اصلی', bot: 'ربات', none: 'بدون مسیر' };
const STATUS_LABEL: Record<string, string> = {
  draft: 'پیش‌نویس', queued: 'در صف', running: 'در حال اجرا', done: 'تمام شد', cancelled: 'لغو شد', failed: 'خطا',
  pending: 'در انتظار', sent: 'ارسال شد', dry_run: 'آزمایشی (ارسال نشد)', skipped: 'رد شد',
};
const fmt = (s: string | null) => { const d = p4.utc(s); return d ? d.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : '—'; };

export default function BulkMessaging({ courses }: { courses: Course[] }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('سلام {{name}} عزیز،\n');
  const [filters, setFilters] = useState<p4.CampaignFilters>({ target: 'students' });
  const [throttle, setThrottle] = useState(3000);
  const [preview, setPreview] = useState<p4.CampaignPreview | null>(null);
  const [campaigns, setCampaigns] = useState<p4.Campaign[]>([]);
  const [openCampaign, setOpenCampaign] = useState<p4.Campaign | null>(null);
  const [recipients, setRecipients] = useState<p4.CampaignRecipient[]>([]);
  const [confirmReal, setConfirmReal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const loadCampaigns = () => p4.listCampaigns().then(setCampaigns).catch((e) => setErr(e.message));
  useEffect(() => { loadCampaigns(); }, []);
  useEffect(() => {
    if (!campaigns.some((c) => c.status === 'queued' || c.status === 'running')) return;
    const t = setInterval(loadCampaigns, 3000); return () => clearInterval(t);
  }, [campaigns]);
  useEffect(() => { setPreview(null); }, [filters, template]);

  const doPreview = async () => {
    setBusy(true); setErr('');
    try { setPreview(await p4.previewCampaign({ template, filters })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const start = async (dry: boolean) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await p4.createCampaign({ name: name || 'کمپین', template, filters, dry_run: dry, throttle_ms: throttle, confirm: dry ? undefined : confirmText });
      setMsg(dry ? `اجرای آزمایشی برای ${r.total.toLocaleString('fa-IR')} گیرنده ساخته شد؛ هیچ پیامی ارسال نمی‌شود.` : `کمپین در صف ارسال قرار گرفت (${r.total.toLocaleString('fa-IR')} گیرنده).`);
      setConfirmReal(false); setConfirmText(''); await loadCampaigns();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const openLog = async (c: p4.Campaign) => { setOpenCampaign(c); setRecipients(await p4.campaignRecipients(c.id).catch(() => [])); };
  const insertVar = (v: string) => setTemplate((t) => `${t}{{${v}}}`);

  return (
    <div className="space-y-4 fade-in">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center"><Megaphone className="w-5 h-5" /></div>
        <div>
          <h2 className="text-base font-black text-slate-900">پیام انبوه روبیکا</h2>
          <p className="text-xs text-slate-400 mt-0.5">انتخاب گیرندگان، قالب پیام با متغیر، پیش‌نمایش و صف ارسال با فاصله زمانی</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 text-xs">
          <h3 className="font-bold text-slate-800">۱. گیرندگان</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">گروه
              <select value={filters.target} onChange={(e) => setFilters({ target: e.target.value as any })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                <option value="students">هنرجویان</option><option value="leads">سرنخ‌ها</option>
              </select></label>
            <label className="space-y-1">دوره
              <select value={filters.course_id || ''} onChange={(e) => setFilters({ ...filters, course_id: Number(e.target.value) || undefined })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                <option value="">همه دوره‌ها</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select></label>
            {filters.target === 'students' ? (<>
              <label className="space-y-1">شماره دوره
                <input type="number" value={filters.course_number || ''} onChange={(e) => setFilters({ ...filters, course_number: Number(e.target.value) || undefined })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5" dir="ltr" /></label>
              <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={!!filters.debtors} onChange={(e) => setFilters({ ...filters, debtors: e.target.checked || undefined })} />فقط بدهکاران</label>
            </>) : (
              <label className="space-y-1">وضعیت سرنخ
                <select value={filters.lead_status || ''} onChange={(e) => setFilters({ ...filters, lead_status: (e.target.value || undefined) as any })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  <option value="">همه</option>{Object.entries(p4.LEAD_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
            )}
          </div>
          <h3 className="font-bold text-slate-800 pt-2">۲. متن پیام</h3>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام کمپین (مثلاً یادآوری قسط مهر)" className="w-full border border-slate-200 rounded-lg px-2 py-1.5" />
          <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={6} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm leading-7" />
          <div className="flex flex-wrap gap-1">
            <span className="text-slate-500">متغیرها:</span>
            {p4.TEMPLATE_VARS.map((v) => <button key={v} onClick={() => insertVar(v)} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 font-mono" dir="ltr">{`{{${v}}}`}</button>)}
          </div>
          <label className="flex items-center gap-2">فاصله بین پیام‌ها (ثانیه)
            <input type="number" min={1} max={60} value={throttle / 1000} onChange={(e) => setThrottle(Math.min(60, Math.max(1, Number(e.target.value) || 3)) * 1000)} className="w-20 border border-slate-200 rounded-lg px-2 py-1" dir="ltr" /></label>
          <button onClick={doPreview} disabled={busy || !template.trim()} className="flex items-center gap-1 px-4 py-2 font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-xl"><Eye className="w-4 h-4" />پیش‌نمایش</button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 text-xs">
          <h3 className="font-bold text-slate-800">۳. پیش‌نمایش و اجرا</h3>
          {!preview ? <p className="text-slate-400">ابتدا «پیش‌نمایش» را بزنید.</p> : (<>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded-lg bg-slate-100 font-bold">کل: {preview.total.toLocaleString('fa-IR')}</span>
              <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">اکانت اصلی: {preview.routes.account.toLocaleString('fa-IR')}</span>
              <span className="px-2 py-1 rounded-lg bg-sky-50 text-sky-700">ربات: {preview.routes.bot.toLocaleString('fa-IR')}</span>
              <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700">بدون گفتگوی روبیکا (رد می‌شود): {preview.routes.none.toLocaleString('fa-IR')}</span>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {preview.recipients.map((r, i) => (
                <div key={i} className="border border-slate-100 rounded-lg p-2">
                  <div className="flex justify-between text-slate-500"><span className="font-bold text-slate-700">{r.name || '—'}</span><span>{ROUTE_LABEL[r.route]}</span></div>
                  <p className="whitespace-pre-wrap text-slate-700 mt-1">{r.text}</p>
                </div>
              ))}
              {preview.total > preview.recipients.length && <p className="text-slate-400">... و {(preview.total - preview.recipients.length).toLocaleString('fa-IR')} نفر دیگر</p>}
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <button onClick={() => start(true)} disabled={busy || preview.total === 0} className="flex items-center gap-1 px-4 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl"><PlayCircle className="w-4 h-4" />اجرای آزمایشی (بدون ارسال)</button>
              <button onClick={() => setConfirmReal(true)} disabled={busy || preview.total === 0 || !preview.send_enabled}
                title={preview.send_enabled ? '' : 'ارسال واقعی روی سرور غیرفعال است'}
                className="flex items-center gap-1 px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 rounded-xl"><ShieldAlert className="w-4 h-4" />ارسال واقعی...</button>
            </div>
            {!preview.send_enabled && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">ارسال واقعی فعلاً روی سرور غیرفعال است؛ فقط اجرای آزمایشی ممکن است.</p>}
          </>)}
          {err && <p className="text-rose-600">{err}</p>}
          {msg && <p className="text-emerald-700">{msg}</p>}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-xs">
        <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-slate-800">کمپین‌ها و گزارش ارسال</h3>
          <button onClick={loadCampaigns} className="p-1.5 border border-slate-200 rounded-lg"><RefreshCw className="w-3.5 h-3.5" /></button></div>
        <div className="overflow-x-auto"><table className="w-full text-right">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">نام</th><th className="p-2">نوع</th><th className="p-2">وضعیت</th><th className="p-2">پیشرفت</th><th className="p-2">زمان</th><th className="p-2"></th></tr></thead>
          <tbody>
            {campaigns.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">هنوز کمپینی ساخته نشده</td></tr>}
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="p-2 font-bold">{c.name}</td>
                <td className="p-2">{Number(c.dry_run) ? <span className="text-slate-600 bg-slate-100 px-1.5 rounded">آزمایشی</span> : <span className="text-rose-700 bg-rose-50 px-1.5 rounded">واقعی</span>}</td>
                <td className="p-2">{STATUS_LABEL[c.status] || c.status}</td>
                <td className="p-2">{(c.sent + c.failed + c.skipped).toLocaleString('fa-IR')} / {c.total.toLocaleString('fa-IR')} · موفق {c.sent.toLocaleString('fa-IR')} · ناموفق {c.failed.toLocaleString('fa-IR')} · رد {c.skipped.toLocaleString('fa-IR')}</td>
                <td className="p-2 whitespace-nowrap">{fmt(c.created_at)}</td>
                <td className="p-2 flex gap-2">
                  <button onClick={() => openLog(c)} className="text-sky-700 hover:underline">گزارش</button>
                  {(c.status === 'queued' || c.status === 'running') && <button onClick={() => p4.cancelCampaign(c.id).then(loadCampaigns)} className="text-rose-600 flex items-center gap-0.5"><Ban className="w-3 h-3" />توقف</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {confirmReal && preview && (
        <ModalPortal><div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 text-sm">
            <h3 className="font-black text-rose-700 flex items-center gap-2"><ShieldAlert className="w-5 h-5" />تأیید ارسال واقعی</h3>
            <p>این پیام برای <b>{(preview.routes.account + preview.routes.bot).toLocaleString('fa-IR')}</b> نفر واقعاً ارسال می‌شود و قابل بازگشت نیست.</p>
            <p className="text-xs text-slate-500">برای تأیید کلمه «ارسال» را تایپ کنید:</p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-full border border-rose-200 rounded-lg px-3 py-2" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmReal(false); setConfirmText(''); }} className="px-4 py-2 text-xs font-bold bg-slate-100 rounded-lg">انصراف</button>
              <button disabled={confirmText.trim() !== 'ارسال' || busy} onClick={() => start(false)} className="px-4 py-2 text-xs font-bold text-white bg-rose-600 disabled:opacity-40 rounded-lg">ارسال</button>
            </div>
          </div>
        </div></ModalPortal>
      )}

      {openCampaign && (
        <ModalPortal><div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-5 space-y-3 text-xs max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between"><h3 className="text-sm font-black">گزارش گیرندگان: {openCampaign.name}</h3><button onClick={() => setOpenCampaign(null)}><X className="w-4 h-4" /></button></div>
            <div className="overflow-auto"><table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr><th className="p-2">نام</th><th className="p-2">مسیر</th><th className="p-2">نتیجه</th><th className="p-2">خطا</th><th className="p-2">زمان</th></tr></thead>
              <tbody>{recipients.map((r) => (
                <tr key={r.id} className="border-t border-slate-100" title={r.rendered}>
                  <td className="p-2">{r.name}</td><td className="p-2">{ROUTE_LABEL[r.route || ''] || '—'}</td>
                  <td className="p-2">{STATUS_LABEL[r.status] || r.status}</td><td className="p-2 text-rose-600">{r.error || ''}</td><td className="p-2 whitespace-nowrap">{fmt(r.processed_at)}</td>
                </tr>))}</tbody>
            </table></div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  );
}
