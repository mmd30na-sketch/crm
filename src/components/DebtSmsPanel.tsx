import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, RefreshCw, Loader2, Send, CheckCircle2, XCircle, AlertTriangle, Trash2 } from 'lucide-react';
import * as debt from '../api/debtSms';
import { listTerms, CourseTerm } from '../api/courseTerms';

const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-200';

const LOG_STYLE: Record<string, string> = {
  sending: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  skipped_test_mode: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Admin/cashier panel: preview the debtors, remove rows, then send the debt SMS in bulk. */
export default function DebtSmsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<debt.DebtSmsSettings | null>(null);
  const [preview, setPreview] = useState<debt.DebtSmsPreview | null>(null);
  const [log, setLog] = useState<debt.DebtSmsLogRow[]>([]);
  const [terms, setTerms] = useState<CourseTerm[]>([]);
  const [termId, setTermId] = useState('');
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [testMobile, setTestMobile] = useState('');

  const load = useCallback(async (term?: string) => {
    setErr(null); setBusy(true);
    try {
      const [st, pv, lg] = await Promise.all([
        debt.getDebtSmsSettings(),
        debt.previewDebtSms(term ? Number(term) : undefined),
        debt.debtSmsLog(),
      ]);
      setSettings(st); setPreview(pv); setLog(lg);
      setEnabled(st.enabled); setTemplateId(String(st.template_id)); setTestMobile('');
      setRemoved(new Set());
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    listTerms().then((t) => setTerms(t.filter((x) => x.status === 'active'))).catch(() => {});
  }, []);

  const items = useMemo(
    () => (preview?.items || []).filter((i) => !removed.has(i.student_id)),
    [preview, removed],
  );
  const toSend = items.filter((i) => i.would_send);

  const changeTerm = (v: string) => { setTermId(v); void load(v); };

  const saveSettings = async () => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const r = await debt.saveDebtSmsSettings({
        enabled,
        template_id: templateId ? Number(templateId) : undefined,
        ...(testMobile ? { test_mobile: testMobile } : {}),
      });
      setNotice('تنظیمات ذخیره شد.');
      setSettings(r); setTestMobile('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const runBulk = async (dryRun: boolean) => {
    if (confirmText !== 'ارسال') { setErr('برای ارسال باید کلمه «ارسال» را تایپ کنید.'); return; }
    setBusy(true); setErr(null); setNotice(null);
    try {
      const r = await debt.sendDebtSmsBulk({
        confirm: confirmText, term_id: termId ? Number(termId) : null,
        student_ids: items.map((i) => i.student_id), dry_run: dryRun,
      });
      setNotice(dryRun
        ? `اجرای آزمایشی: ${fa(r.dry_run_count)} مورد قابل ارسال، ${fa(r.skipped)} مورد رد شد.`
        : `ارسال انجام شد: ${fa(r.sent)} موفق، ${fa(r.failed)} ناموفق، ${fa(r.skipped)} رد‌شده.`);
      setConfirmText('');
      await load(termId);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const sendOne = async (studentId: number) => {
    if (confirmText !== 'ارسال') { setErr('برای ارسال باید کلمه «ارسال» را تایپ کنید.'); return; }
    setBusy(true); setErr(null); setNotice(null);
    try {
      const r = await debt.sendDebtSmsToStudent(studentId, confirmText);
      setNotice(r.status === 'sent' ? 'پیامک ارسال شد.' : `نتیجه: ${debt.STATUS_LABEL[r.status as debt.DebtSmsStatus] || r.status}`);
      setConfirmText('');
      await load(termId);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (settings === null && busy) return <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center"><BellRing className="w-4 h-4" /></div>
            <div>
              <h3 className="text-sm font-black text-slate-800">ارسال پیامک مانده بدهی</h3>
              <p className="text-[11px] text-slate-500">پیامک sms.ir با مبلغ کل بدهی و لینک پرداخت کامل</p>
            </div>
          </div>
          <button onClick={() => load(termId)} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`px-2.5 py-1 rounded-full border font-bold ${settings?.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {settings?.enabled ? 'فعال' : 'غیرفعال'}
            </span>
            {!settings?.env_enabled && <span className="px-2.5 py-1 rounded-full border font-bold bg-slate-100 text-slate-600 border-slate-200">کلید سروری (CRM_DEBT_SMS_ENABLED) خاموش است؛ فعال‌سازی فقط از سرور</span>}
            {settings?.test_mode && <span className="px-2.5 py-1 rounded-full border font-bold bg-amber-50 text-amber-700 border-amber-200">حالت آزمایشی: {settings.test_mobile_masked}{settings.test_mobile_env ? ' (از متغیر محیطی)' : ''}</span>}
            {!settings?.configured && <span className="px-2.5 py-1 rounded-full border font-bold bg-rose-50 text-rose-700 border-rose-200">درگاه پیامک تنظیم نشده</span>}
            <span className="text-slate-500">قالب: <span className="font-mono">{settings?.template_id}</span></span>
            <span className="text-slate-500">امروز: <span className="font-mono">{settings?.today}</span></span>
          </div>

          {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}
          {notice && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}

          {isAdmin && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <label className="text-[11px] font-bold text-slate-600 space-y-1">وضعیت {!settings?.env_enabled && <span className="text-slate-400">(فقط غیرفعال‌کردن)</span>}
                <select value={settings?.env_enabled && enabled ? '1' : '0'} disabled={!settings?.env_enabled} onChange={(e) => setEnabled(e.target.value === '1')} className={inputCls + (settings?.env_enabled ? '' : ' opacity-60')}>
                  <option value="0">غیرفعال</option><option value="1">فعال</option>
                </select>
              </label>
              <label className="text-[11px] font-bold text-slate-600 space-y-1">شناسه قالب sms.ir
                <input inputMode="numeric" value={templateId} onChange={(e) => setTemplateId(e.target.value.replace(/[^\d۰-۹]/g, ''))} className={inputCls + ' font-mono'} dir="ltr" />
              </label>
              <label className="text-[11px] font-bold text-slate-600 space-y-1 sm:col-span-2">شماره آزمایشی (خالی = بدون تغییر)
                <input value={testMobile} disabled={!!settings?.test_mobile_env} onChange={(e) => setTestMobile(e.target.value.replace(/[^\d۰-۹+]/g, ''))} className={inputCls + ' font-mono' + (settings?.test_mobile_env ? ' opacity-60' : '')} dir="ltr" placeholder="09xxxxxxxxx" />
                {settings?.test_mobile_env && <span className="block text-[10px] font-normal text-amber-600">شماره آزمایشی از متغیر محیطی (CRM_DEBT_SMS_TEST_MOBILE) فعال است و از تنظیمات قابل تغییر نیست.</span>}
              </label>
              <div className="sm:col-span-2 lg:col-span-4">
                <button disabled={busy} onClick={saveSettings} className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-xs font-bold">ذخیره تنظیمات</button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-bold text-slate-600 space-y-1">فیلتر دوره
              <select value={termId} onChange={(e) => changeTerm(e.target.value)} className={inputCls + ' min-w-[14rem]'}>
                <option value="">همه بدهکاران</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.course_title} · دوره {fa(t.course_number)}{t.title ? ` · ${t.title}` : ''}</option>)}
              </select>
            </label>
            <span className="text-[11px] text-slate-500 pb-2">قابل ارسال: <span className="font-bold text-slate-700">{fa(toSend.length)}</span> از {fa(items.length)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black text-slate-700">پیش‌نمایش بدهکاران</span>
          <div className="flex flex-wrap items-center gap-2">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="برای تأیید «ارسال» را تایپ کنید" className={inputCls + ' w-56'} />
            <button disabled={busy || confirmText !== 'ارسال' || items.length === 0} onClick={() => runBulk(true)} className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-300 rounded-xl">اجرای آزمایشی</button>
            <button disabled={busy || confirmText !== 'ارسال' || toSend.length === 0} onClick={() => runBulk(false)} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-xl"><Send className="w-3.5 h-3.5" />ارسال به {fa(toSend.length)} نفر</button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" />بدهکار دیگری برای ارسال نیست.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-right min-w-[46rem]">
              <thead className="bg-slate-50 text-slate-500"><tr>
                {['کارآموز', 'همراه', 'مانده بدهی', 'وضعیت', ''].map((h, i) => <th key={i} className="px-3 py-2 font-bold">{h}</th>)}
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.student_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{it.name_masked || '—'}</td>
                    <td className="px-3 py-2 font-mono" dir="ltr">{it.mobile_masked || '—'}</td>
                    <td className="px-3 py-2 font-bold text-rose-700">{it.amount_text} <span className="text-[10px] font-normal text-slate-400">تومان</span></td>
                    <td className="px-3 py-2">
                      {it.would_send
                        ? <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="w-3.5 h-3.5" />{debt.REASON_LABEL[it.reason]}</span>
                        : <span className="inline-flex items-center gap-1 text-slate-500"><XCircle className="w-3.5 h-3.5" />{debt.REASON_LABEL[it.reason]}</span>}
                    </td>
                    <td className="px-3 py-2 text-left whitespace-nowrap">
                      <button disabled={busy || confirmText !== 'ارسال' || !it.would_send} onClick={() => sendOne(it.student_id)} className="text-sky-600 font-bold hover:underline disabled:text-slate-300 disabled:no-underline ml-3">ارسال</button>
                      <button onClick={() => setRemoved((s) => new Set(s).add(it.student_id))} className="text-slate-400 hover:text-rose-600" aria-label="حذف از فهرست"><Trash2 className="w-3.5 h-3.5 inline" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.length > 0 && (
          <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-500 bg-slate-50">
            نمونه متن (متن نهایی از قالب sms.ir می‌آید): <span className="text-slate-700">{items[0].text_preview}</span>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 flex items-center gap-2 text-[11px] font-black text-slate-700"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" />گزارش ارسال (هر کارآموز یک پیامک در روز)</div>
        {log.length === 0 ? <div className="text-xs text-slate-400 py-6 text-center">گزارشی ثبت نشده است.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-right min-w-[44rem]">
              <thead className="bg-slate-50 text-slate-500"><tr>
                {['کارآموز', 'روز', 'همراه', 'مبلغ', 'وضعیت', 'کد لینک', 'خطا', 'زمان'].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}
              </tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.name_masked || `#${fa(r.student_id)}`}</td>
                    <td className="px-3 py-2 font-mono">{r.send_day}</td>
                    <td className="px-3 py-2 font-mono" dir="ltr">{r.mobile_masked || '—'}</td>
                    <td className="px-3 py-2">{fa(r.amount)}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full border font-bold ${LOG_STYLE[r.status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>{debt.STATUS_LABEL[r.status] || r.status}</span></td>
                    <td className="px-3 py-2 font-mono text-slate-500" dir="ltr">{r.link_code || '—'}</td>
                    <td className="px-3 py-2 text-rose-600">{r.error === 'link_failed' ? debt.REASON_LABEL.link_failed : (r.error || '—')}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
