// Email («ایمیل»): transactional send (receipt / certificate / reminder) with preview and dry-run, campaign composer
// with audience filter + dry-run preview, template editor (admin), student email contacts, and the send log.
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Loader2, RefreshCw, Save, Search, Send, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import * as api from '../api/email';

const BTN = 'inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50';
const BTN_DANGER = 'inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50';
const BTN_LIGHT = 'inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const INPUT = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200';
const CARD = 'rounded-2xl border border-slate-200 bg-white p-4';
const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('fa-IR') : '—');

const STATUS_FA: Record<string, string> = {
  sent: 'ارسال شد', failed: 'ناموفق', dry_run: 'آزمایشی (ارسال نشد)', skipped_unsubscribed: 'لغو اشتراک کرده',
  skipped_no_email: 'ایمیل ندارد', skipped_disabled: 'ارسال خاموش است', rate_limited: 'سقف ساعتی',
};
const STATUS_CLS: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-800', failed: 'bg-rose-100 text-rose-800', dry_run: 'bg-sky-100 text-sky-800',
  skipped_unsubscribed: 'bg-slate-100 text-slate-700', skipped_no_email: 'bg-slate-100 text-slate-700',
  skipped_disabled: 'bg-amber-100 text-amber-800', rate_limited: 'bg-amber-100 text-amber-800',
};
const CAMPAIGN_FA: Record<string, string> = { draft: 'پیش‌نویس', sending: 'در حال ارسال', done: 'پایان یافته', cancelled: 'لغو شده' };
const TEMPLATE_FA: Record<string, string> = { receipt: 'رسید پرداخت', certificate: 'گواهی پایان دوره', reminder: 'یادآوری', campaign: 'کمپین' };

type Tab = 'send' | 'campaign' | 'templates' | 'contacts' | 'log';
type CourseOpt = { id: number; title: string };

function Badge({ status }: { status: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${STATUS_CLS[status] || 'bg-slate-100 text-slate-700'}`}>{STATUS_FA[status] || status}</span>;
}
function Preview({ html }: { html: string }) {
  // sandbox without scripts: the HTML is server-rendered with escaped values, and the frame cannot run code.
  return <iframe title="پیش‌نمایش ایمیل" srcDoc={html} sandbox="" className="h-[480px] w-full rounded-xl border border-slate-200 bg-white" />;
}

export default function EmailPanel({ isAdmin, courses }: { isAdmin: boolean; courses: CourseOpt[] }) {
  const [tab, setTab] = useState<Tab>('send');
  const [status, setStatus] = useState<api.EmailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadStatus = useCallback(() => { api.getEmailStatus().then(setStatus).catch((e) => setError(e.message)); }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const tabs: { id: Tab; label: string; admin?: boolean }[] = [
    { id: 'send', label: 'ارسال تراکنشی' }, { id: 'campaign', label: 'کمپین', admin: true },
    { id: 'templates', label: 'قالب‌ها' }, { id: 'contacts', label: 'ایمیل کارآموزان' }, { id: 'log', label: 'گزارش ارسال' },
  ];
  return (
    <div className="space-y-4" dir="rtl">
      {status && (
        <div className={`${CARD} ${status.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {status.enabled ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
            {status.enabled ? 'ارسال ایمیل روشن است' : 'ارسال ایمیل در سرور خاموش است (CRM_EMAIL_ENABLED)؛ هیچ ایمیلی واقعاً فرستاده نمی‌شود.'}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className={`rounded-full px-2 py-0.5 ${status.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>SMTP: {status.configured ? `تنظیم شده (${status.from_masked})` : 'تنظیم نشده'}</span>
            {status.test_to_masked && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-800">حالت تست: همهٔ ایمیل‌ها به {status.test_to_masked} می‌رود</span>}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">سقف: {fa(status.max_per_hour)} ایمیل در ساعت</span>
            <span className={`rounded-full px-2 py-0.5 ${status.unsubscribe_ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>لینک لغو اشتراک: {status.unsubscribe_ready ? 'آماده' : 'CRM_EMAIL_UNSUB_SECRET تنظیم نشده'}</span>
            {!status.mysql && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">MySQL در دسترس نیست</span>}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.filter((t) => !t.admin || isAdmin).map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setError(null); }}
            className={`px-4 py-2 text-xs font-medium ${tab === t.id ? 'border-b-2 border-indigo-500 text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}>{t.label}</button>
        ))}
      </div>
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
      {tab === 'send' && <SendTab setError={setError} />}
      {tab === 'campaign' && isAdmin && <CampaignTab courses={courses} setError={setError} />}
      {tab === 'templates' && <TemplatesTab isAdmin={isAdmin} setError={setError} />}
      {tab === 'contacts' && <ContactsTab setError={setError} />}
      {tab === 'log' && <LogTab setError={setError} />}
    </div>
  );
}

/* ---------------- student picker ---------------- */
function StudentPicker({ value, onChange }: { value: api.Contact | null; onChange: (c: api.Contact | null) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<api.Contact[]>([]);
  const [busy, setBusy] = useState(false);
  const search = async () => { setBusy(true); try { setList(await api.listContacts(q.trim())); } finally { setBusy(false); } };
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs">
        <span className="font-medium">{value.name}</span>
        <span dir="ltr" className="text-slate-500">{value.has_email ? value.email_masked : 'بدون ایمیل'}</span>
        <button className="mr-auto text-indigo-700 underline" onClick={() => onChange(null)}>تغییر</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={INPUT} placeholder="نام کارآموز…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} />
        <button className={BTN_LIGHT} onClick={search} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} جستجو</button>
      </div>
      {list.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200">
          {list.map((c) => (
            <button key={c.student_id} onClick={() => onChange(c)} className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-right text-xs hover:bg-slate-50">
              <span>{c.name}</span><span className="text-slate-400">#{fa(c.student_id)}</span>
              <span dir="ltr" className="mr-auto text-slate-500">{c.has_email ? c.email_masked : '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- transactional ---------------- */
function SendTab({ setError }: { setError: (m: string | null) => void }) {
  const [key, setKey] = useState<'receipt' | 'certificate' | 'reminder'>('receipt');
  const [student, setStudent] = useState<api.Contact | null>(null);
  const [paymentId, setPaymentId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [message, setMessage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [result, setResult] = useState<{ status: string; to_masked: string; test_override: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = () => ({
    student_id: student!.student_id,
    payment_id: key === 'receipt' && Number(paymentId) ? Number(paymentId) : undefined,
    enrollment_id: key !== 'receipt' && Number(enrollmentId) ? Number(enrollmentId) : undefined,
    vars: key === 'reminder' ? { message, due_date: dueDate } : undefined,
  });
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const doPreview = () => run(async () => { setPreview(await api.previewTemplate(key, input())); });
  const doSend = () => run(async () => {
    if (!dryRun && !window.confirm('ایمیل واقعاً ارسال شود؟ (اگر حالت تست فعال باشد به آدرس تست می‌رود)')) return;
    setResult(await api.sendEmail({ template_key: key, ...input(), dry_run: dryRun }));
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${CARD} space-y-3`}>
        <label className="block text-xs text-slate-600">قالب
          <select className={`${INPUT} mt-1`} value={key} onChange={(e) => { setKey(e.target.value as typeof key); setPreview(null); setResult(null); }}>
            <option value="receipt">رسید پرداخت</option><option value="certificate">گواهی پایان دوره</option><option value="reminder">یادآوری</option>
          </select>
        </label>
        <div className="text-xs text-slate-600">کارآموز<div className="mt-1"><StudentPicker value={student} onChange={(c) => { setStudent(c); setPreview(null); setResult(null); }} /></div></div>
        {key === 'receipt' && <label className="block text-xs text-slate-600">شمارهٔ پرداخت (اختیاری؛ وگرنه فقط مانده بدهی)
          <input className={`${INPUT} mt-1`} dir="ltr" inputMode="numeric" value={paymentId} onChange={(e) => setPaymentId(e.target.value.replace(/\D/g, ''))} /></label>}
        {key !== 'receipt' && <label className="block text-xs text-slate-600">شمارهٔ ثبت‌نام دوره (اختیاری؛ وگرنه آخرین ثبت‌نام)
          <input className={`${INPUT} mt-1`} dir="ltr" inputMode="numeric" value={enrollmentId} onChange={(e) => setEnrollmentId(e.target.value.replace(/\D/g, ''))} /></label>}
        {key === 'reminder' && (<>
          <label className="block text-xs text-slate-600">متن یادآوری<textarea className={`${INPUT} mt-1`} rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          <label className="block text-xs text-slate-600">تاریخ سررسید (شمسی)<input className={`${INPUT} mt-1`} placeholder="۱۴۰۵/۰۸/۱۵" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </>)}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> فقط آزمایشی (Dry-run) — فقط در گزارش ثبت می‌شود</label>
        <div className="flex gap-2">
          <button className={BTN_LIGHT} disabled={!student || busy} onClick={doPreview}><Eye className="h-3.5 w-3.5" /> پیش‌نمایش</button>
          <button className={dryRun ? BTN : BTN_DANGER} disabled={!student || busy} onClick={doSend}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {dryRun ? 'ثبت آزمایشی' : 'ارسال واقعی'}
          </button>
        </div>
        {student && !student.has_email && <div className="text-[11px] text-amber-700">این کارآموز ایمیل ثبت‌شده ندارد؛ از تب «ایمیل کارآموزان» اضافه کنید.</div>}
        {result && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 text-xs">
            {result.status === 'sent' || result.status === 'dry_run' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}
            <Badge status={result.status} /><span dir="ltr" className="text-slate-500">{result.to_masked}</span>
          </div>
        )}
      </div>
      <div className={CARD}>
        {preview ? (<><div className="mb-2 text-xs text-slate-600">موضوع: <b>{preview.subject}</b></div><Preview html={preview.html} /></>)
          : <div className="p-8 text-center text-xs text-slate-400">برای دیدن ایمیل، «پیش‌نمایش» را بزنید.</div>}
      </div>
    </div>
  );
}

/* ---------------- campaigns ---------------- */
function CampaignTab({ courses, setError }: { courses: CourseOpt[]; setError: (m: string | null) => void }) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [filters, setFilters] = useState<api.Filters>({ target: 'all' });
  const [preview, setPreview] = useState<api.CampaignPreview | null>(null);
  const [list, setList] = useState<api.Campaign[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.listCampaigns().then(setList).catch((e) => setError(e.message)); }, [setError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { // poll while a campaign is sending
    if (!list.some((c) => c.status === 'sending')) return;
    const t = setTimeout(load, 4000); return () => clearTimeout(t);
  }, [list, load]);
  useEffect(() => { // start from the campaign template
    api.listTemplates().then((ts) => { const t = ts.find((x) => x.key === 'campaign'); if (t) { setSubject((s) => s || t.subject); setBody((b) => b || t.body); } }).catch(() => undefined);
  }, []);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const doPreview = () => run(async () => setPreview(await api.previewCampaign({ subject, body, filters })));
  const doCreate = () => run(async () => { await api.createCampaign({ name, subject, body, filters }); setName(''); setPreview(null); load(); });
  const doSend = (c: api.Campaign, dry: boolean) => run(async () => {
    let confirm: string | undefined;
    if (!dry) {
      const typed = window.prompt(`ارسال واقعی کمپین «${c.name}». برای تأیید کلمهٔ «ارسال» را تایپ کنید:`);
      if (typed === null) return; confirm = typed;
    }
    const r = await api.sendCampaign(c.id, dry, confirm);
    window.alert(`${dry ? 'اجرای آزمایشی' : 'ارسال'} برای ${fa(r.total)} گیرنده شروع شد${r.test_override ? ' (حالت تست: همه به آدرس تست)' : ''}.`);
    load();
  });
  const doCancel = (c: api.Campaign) => run(async () => { await api.cancelCampaign(c.id); load(); });
  const targetFa = (f: api.Filters | null) => !f ? '—' : f.target === 'course' ? `دوره: ${courses.find((x) => x.id === f.course_id)?.title || f.course_id}` : f.target === 'debtors' ? `بدهکاران (≥ ${fa(Number(f.min_debt) || 1)})` : 'همهٔ دارندگان ایمیل';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-semibold text-slate-700">کمپین جدید</h3>
          <input className={INPUT} placeholder="نام کمپین (داخلی)" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          <input className={INPUT} placeholder="موضوع ایمیل" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          <textarea className={INPUT} rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن ایمیل؛ متغیرها: {full_name} {name} {family} {academy}" />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-600">مخاطبان
              <select className={`${INPUT} mt-1`} value={filters.target} onChange={(e) => setFilters({ target: e.target.value as api.Filters['target'] })}>
                <option value="all">همهٔ کارآموزان دارای ایمیل</option><option value="course">ثبت‌نامی‌های یک دوره</option><option value="debtors">بدهکاران</option>
              </select>
            </label>
            {filters.target === 'course' && <label className="text-xs text-slate-600">دوره
              <select className={`${INPUT} mt-1`} value={filters.course_id ?? ''} onChange={(e) => setFilters({ target: 'course', course_id: Number(e.target.value) || null })}>
                <option value="">انتخاب…</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select></label>}
            {filters.target === 'debtors' && <label className="text-xs text-slate-600">حداقل بدهی (تومان)
              <input className={`${INPUT} mt-1`} dir="ltr" inputMode="numeric" value={filters.min_debt ?? ''} onChange={(e) => setFilters({ target: 'debtors', min_debt: Number(e.target.value.replace(/\D/g, '')) || null })} /></label>}
          </div>
          <div className="text-[11px] text-slate-500">کسانی که لغو اشتراک کرده‌اند خودکار حذف می‌شوند. هر ایمیل کمپین لینک لغو اشتراک دارد.</div>
          <div className="flex gap-2">
            <button className={BTN_LIGHT} disabled={busy || !subject.trim() || !body.trim()} onClick={doPreview}><Eye className="h-3.5 w-3.5" /> پیش‌نمایش مخاطبان</button>
            <button className={BTN} disabled={busy || !subject.trim() || !body.trim()} onClick={doCreate}><Save className="h-3.5 w-3.5" /> ذخیره به‌عنوان پیش‌نویس</button>
          </div>
        </div>
        <div className={`${CARD} space-y-3`}>
          {preview ? (<>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-slate-50 p-2">دارای ایمیل<div className="text-base font-bold">{fa(preview.with_email)}</div></div>
              <div className="rounded-xl bg-slate-50 p-2">لغو اشتراک<div className="text-base font-bold text-slate-500">{fa(preview.unsubscribed)}</div></div>
              <div className="rounded-xl bg-indigo-50 p-2">ارسال به<div className="text-base font-bold text-indigo-700">{fa(preview.will_send)}</div></div>
            </div>
            {preview.capped && <div className="text-[11px] text-amber-700">فقط ۵٬۰۰۰ گیرندهٔ اول در نظر گرفته می‌شود.</div>}
            <div className="max-h-28 overflow-y-auto text-[11px] text-slate-600">{preview.sample.map((s, i) => <div key={i}>{s.name} — <span dir="ltr">{s.email_masked}</span></div>)}</div>
            <div className="text-xs text-slate-600">موضوع: <b>{preview.rendered.subject}</b></div>
            <Preview html={preview.rendered.html} />
          </>) : <div className="p-8 text-center text-xs text-slate-400">«پیش‌نمایش مخاطبان» تعداد گیرندگان و نمونهٔ ایمیل را نشان می‌دهد؛ چیزی ارسال نمی‌شود.</div>}
        </div>
      </div>
      <div className={`${CARD} overflow-x-auto`}>
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-700">کمپین‌ها</h3><button className={BTN_LIGHT} onClick={load}><RefreshCw className="h-3.5 w-3.5" /></button></div>
        <table className="min-w-full text-xs">
          <thead className="text-slate-500"><tr><th className="p-2 text-right">نام</th><th className="p-2 text-right">مخاطبان</th><th className="p-2">وضعیت</th><th className="p-2">کل / ارسال / ناموفق / ردشده</th><th className="p-2">زمان</th><th className="p-2"></th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="p-2">{c.name}<div className="text-[10px] text-slate-400">{c.subject}</div></td>
                <td className="p-2">{targetFa(c.filters)}</td>
                <td className="p-2 text-center">{CAMPAIGN_FA[c.status]}{c.status !== 'draft' && c.dry_run && <div className="text-[10px] text-sky-700">آزمایشی</div>}</td>
                <td className="p-2 text-center">{fa(c.total)} / {fa(c.sent)} / {fa(c.failed)} / {fa(c.skipped)}</td>
                <td className="p-2 text-center text-[10px] text-slate-500">{dt(c.started_at || c.created_at)}</td>
                <td className="p-2">
                  <div className="flex justify-end gap-1">
                    {(c.status === 'draft' || (c.status === 'done' && c.dry_run)) && (<>
                      <button className={BTN_LIGHT} disabled={busy} onClick={() => doSend(c, true)}>اجرای آزمایشی</button>
                      <button className={BTN_DANGER} disabled={busy} onClick={() => doSend(c, false)}>ارسال واقعی</button>
                    </>)}
                    {(c.status === 'draft' || c.status === 'sending') && <button className={BTN_LIGHT} disabled={busy} onClick={() => doCancel(c)}>لغو</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">کمپینی وجود ندارد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- templates ---------------- */
function TemplatesTab({ isAdmin, setError }: { isAdmin: boolean; setError: (m: string | null) => void }) {
  const [list, setList] = useState<api.EmailTemplate[]>([]);
  const [sel, setSel] = useState<api.TemplateKey>('receipt');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const ts = await api.listTemplates(); setList(ts); const t = ts.find((x) => x.key === sel); if (t) { setSubject(t.subject); setBody(t.body); } } catch (e: any) { setError(e.message); }
  }, [sel, setError]);
  useEffect(() => { void load(); setHtml(''); }, [load]);
  const cur = list.find((t) => t.key === sel);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${CARD} space-y-3`}>
        <div className="flex flex-wrap gap-1">
          {list.map((t) => <button key={t.key} onClick={() => setSel(t.key)} className={`rounded-xl px-3 py-1 text-xs ${sel === t.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{TEMPLATE_FA[t.key] || t.title}{t.overridden ? ' *' : ''}</button>)}
        </div>
        <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!isAdmin} maxLength={200} />
        <textarea className={`${INPUT} font-mono`} rows={14} value={body} onChange={(e) => setBody(e.target.value)} disabled={!isAdmin} />
        {cur && <div className="text-[11px] text-slate-500" dir="ltr">{cur.vars.map((v) => `{${v}}`).join('  ')}</div>}
        <div className="text-[11px] text-slate-500">پاراگراف‌ها با یک خط خالی جدا می‌شوند. خط <code>[[table]]</code> در ابتدای پاراگراف، خطوط «عنوان: مقدار» را جدول می‌کند و <code>[[certificate]]</code> قاب گواهی می‌سازد.</div>
        <div className="flex flex-wrap gap-2">
          <button className={BTN_LIGHT} disabled={busy} onClick={() => run(async () => setHtml((await api.previewTemplate(sel, { subject, body })).html))}><Eye className="h-3.5 w-3.5" /> پیش‌نمایش با دادهٔ نمونه</button>
          {isAdmin && <button className={BTN} disabled={busy} onClick={() => run(async () => { await api.saveTemplate(sel, subject, body); await load(); })}><Save className="h-3.5 w-3.5" /> ذخیره</button>}
          {isAdmin && cur?.overridden && <button className={BTN_LIGHT} disabled={busy} onClick={() => run(async () => { if (window.confirm('قالب به متن پیش‌فرض برگردد؟')) { await api.resetTemplate(sel); await load(); } })}><Undo2 className="h-3.5 w-3.5" /> بازگشت به پیش‌فرض</button>}
        </div>
      </div>
      <div className={CARD}>{html ? <Preview html={html} /> : <div className="p-8 text-center text-xs text-slate-400">پیش‌نمایش اینجا نمایش داده می‌شود.</div>}</div>
    </div>
  );
}

/* ---------------- contacts ---------------- */
function ContactsTab({ setError }: { setError: (m: string | null) => void }) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [list, setList] = useState<api.Contact[]>([]);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setList(await api.listContacts(q.trim(), only)); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }, [q, only, setError]);
  useEffect(() => { void load(); }, [only]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (c: api.Contact) => {
    setError(null);
    try { await api.setContactEmail(c.student_id, (edit[c.student_id] ?? '').trim()); setEdit((e) => { const n = { ...e }; delete n[c.student_id]; return n; }); await load(); } catch (e: any) { setError(e.message); }
  };
  return (
    <div className={`${CARD} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${INPUT} max-w-xs`} placeholder="نام کارآموز…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
        <button className={BTN_LIGHT} onClick={load} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} جستجو</button>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> فقط دارای ایمیل</label>
        <span className="mr-auto text-[11px] text-slate-500">ایمیل‌ها برای حفظ حریم خصوصی ماسک‌شده نمایش داده می‌شوند. برای حذف، فیلد را خالی ذخیره کنید.</span>
      </div>
      <table className="min-w-full text-xs">
        <thead className="text-slate-500"><tr><th className="p-2 text-right">کارآموز</th><th className="p-2 text-right">ایمیل فعلی</th><th className="p-2 text-right">ایمیل جدید</th><th className="p-2"></th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.student_id} className="border-t border-slate-100">
              <td className="p-2">{c.name} <span className="text-slate-400">#{fa(c.student_id)}</span></td>
              <td className="p-2" dir="ltr">{c.has_email ? c.email_masked : '—'} {c.unsubscribed && <span className="rounded-full bg-slate-100 px-2 text-[10px] text-slate-600">لغو اشتراک</span>}</td>
              <td className="p-2"><input className={INPUT} dir="ltr" type="email" placeholder="name@example.com" value={edit[c.student_id] ?? ''} onChange={(e) => setEdit((x) => ({ ...x, [c.student_id]: e.target.value }))} /></td>
              <td className="p-2"><button className={BTN_LIGHT} disabled={edit[c.student_id] === undefined} onClick={() => save(c)}><Save className="h-3.5 w-3.5" /> ذخیره</button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={4} className="p-4 text-center text-slate-400">موردی یافت نشد.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- log ---------------- */
function LogTab({ setError }: { setError: (m: string | null) => void }) {
  const [kind, setKind] = useState('');
  const [st, setSt] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ rows: api.LogRow[]; total: number }>({ rows: [], total: 0 });
  const limit = 50;
  const load = useCallback(() => { api.getEmailLog({ kind, status: st, limit, offset }).then(setData).catch((e) => setError(e.message)); }, [kind, st, offset, setError]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className={`${CARD} space-y-3 overflow-x-auto`}>
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${INPUT} max-w-[160px]`} value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0); }}>
          <option value="">همهٔ انواع</option><option value="transactional">تراکنشی</option><option value="campaign">کمپین</option>
        </select>
        <select className={`${INPUT} max-w-[180px]`} value={st} onChange={(e) => { setSt(e.target.value); setOffset(0); }}>
          <option value="">همهٔ وضعیت‌ها</option>{Object.entries(STATUS_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className={BTN_LIGHT} onClick={load}><RefreshCw className="h-3.5 w-3.5" /></button>
        <span className="mr-auto text-[11px] text-slate-500">{fa(data.total)} ردیف</span>
      </div>
      <table className="min-w-full text-xs">
        <thead className="text-slate-500"><tr><th className="p-2 text-right">زمان</th><th className="p-2 text-right">نوع</th><th className="p-2 text-right">گیرنده</th><th className="p-2 text-right">موضوع</th><th className="p-2">وضعیت</th><th className="p-2 text-right">توسط</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="p-2 text-[10px] text-slate-500">{dt(r.created_at)}</td>
              <td className="p-2">{r.kind === 'campaign' ? `کمپین #${fa(r.campaign_id || 0)}` : TEMPLATE_FA[r.template_key || ''] || r.template_key}</td>
              <td className="p-2" dir="ltr">{r.to_masked || '—'}</td>
              <td className="p-2">{r.subject}</td>
              <td className="p-2 text-center"><Badge status={r.status} />{r.error && <div className="text-[10px] text-rose-600" dir="ltr">{r.error}</div>}</td>
              <td className="p-2 text-slate-500">{r.created_by || '—'}</td>
            </tr>
          ))}
          {!data.rows.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">رکوردی نیست.</td></tr>}
        </tbody>
      </table>
      <div className="flex justify-center gap-2">
        <button className={BTN_LIGHT} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>قبلی</button>
        <button className={BTN_LIGHT} disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>بعدی</button>
      </div>
    </div>
  );
}
