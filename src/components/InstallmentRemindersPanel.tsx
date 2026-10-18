import React, { useCallback, useEffect, useState } from 'react';
import { Bell, RefreshCw, Loader2, Send, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import * as inst from '../api/installments';

const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-200';

const REASON_LABEL: Record<string, string> = {
  ok: 'قابل ارسال', already_sent: 'قبلاً ارسال شده', enrollment_settled: 'مانده تسویه شده',
  no_mobile: 'شماره موبایل معتبر نیست', test_mode_skip: 'حالت آزمایشی: شماره غیرمجاز', disabled: 'غیرفعال',
  not_configured: 'درگاه پیامک تنظیم نشده',
};
const LOG_STYLE: Record<string, string> = {
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  dry_run: 'bg-sky-50 text-sky-700 border-sky-200',
  skipped_test_mode: 'bg-amber-50 text-amber-700 border-amber-200',
  skipped_disabled: 'bg-slate-100 text-slate-500 border-slate-200',
};
const LOG_LABEL: Record<string, string> = {
  sent: 'ارسال‌شده', failed: 'ناموفق', dry_run: 'آزمایشی', skipped_test_mode: 'رد (حالت آزمایشی)', skipped_disabled: 'رد (غیرفعال)',
};

/** Admin panel: reminder status, a no-side-effect preview and the send log. */
export default function InstallmentRemindersPanel() {
  const [status, setStatus] = useState<inst.ReminderStatusView | null>(null);
  const [preview, setPreview] = useState<inst.ReminderPreview | null>(null);
  const [log, setLog] = useState<inst.ReminderLogRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [cron, setCron] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [testMobile, setTestMobile] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const load = useCallback(async () => {
    setErr(null); setBusy(true);
    try {
      const [st, pv, lg] = await Promise.all([inst.getReminderSettings(), inst.previewReminders(), inst.reminderLog()]);
      setStatus(st); setPreview(pv); setLog(lg);
      setEnabled(st.enabled); setCron(st.cron); setTemplateId(String(st.template_id)); setTestMobile('');
      setDays(String(st.days_before));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const reloadPreview = async () => {
    setBusy(true); setErr(null);
    try { setPreview(await inst.previewReminders(days ? Number(days) : undefined)); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const r = await inst.saveReminderSettings({
        enabled, cron, template_id: templateId ? Number(templateId) : undefined, days_before: days ? Number(days) : undefined,
        ...(testMobile ? { test_mobile: testMobile } : {}),
      });
      setNotice('تنظیمات ذخیره شد.');
      setStatus((s) => (s ? { ...s, enabled: r.enabled, days_before: r.days_before, template_id: r.template_id, cron: r.cron } : s));
      setTestMobile('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const runNow = async () => {
    if (confirmText !== 'ارسال') { setErr('برای ارسال باید کلمه «ارسال» را تایپ کنید.'); return; }
    setBusy(true); setErr(null); setNotice(null);
    try {
      const r = await inst.runRemindersNow({ confirm: confirmText, dry_run: true, days: days ? Number(days) : undefined });
      setNotice(`اجرای آزمایشی ثبت شد (${fa(r.dry_run_count ?? 0)} مورد).`);
      setConfirmText('');
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (status === null && busy) return <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" dir="rtl">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><Bell className="w-4 h-4" /></div>
          <div>
            <h3 className="text-sm font-black text-slate-800">یادآوری خودکار اقساط</h3>
            <p className="text-[11px] text-slate-500">ارسال پیامک sms.ir پیش از سررسید قسط با لینک پرداخت</p>
          </div>
        </div>
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`px-2.5 py-1 rounded-full border font-bold ${status?.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
            {status?.enabled ? 'فعال' : 'غیرفعال'}
          </span>
          {status?.test_mode && <span className="px-2.5 py-1 rounded-full border font-bold bg-amber-50 text-amber-700 border-amber-200">حالت آزمایشی: {status.test_mobile_masked}</span>}
          {!status?.configured && <span className="px-2.5 py-1 rounded-full border font-bold bg-rose-50 text-rose-700 border-rose-200">درگاه پیامک تنظیم نشده</span>}
          <span className="text-slate-500">قالب: <span className="font-mono">{status?.template_id}</span></span>
          <span className="text-slate-500">زمان‌بندی: <span className="font-mono" dir="ltr">{status?.cron}</span> ({status?.timezone})</span>
          <span className="text-slate-500">یادآوری: {fa(status?.days_before || 0)} روز قبل</span>
        </div>

        {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}
        {notice && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-[11px] font-bold text-slate-600 space-y-1">وضعیت
            <select value={enabled ? '1' : '0'} onChange={(e) => setEnabled(e.target.value === '1')} className={inputCls}>
              <option value="0">غیرفعال</option><option value="1">فعال</option>
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600 space-y-1">روز قبل از سررسید
            <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d۰-۹]/g, ''))} className={inputCls + ' font-mono'} />
          </label>
          <label className="text-[11px] font-bold text-slate-600 space-y-1">شناسه قالب sms.ir
            <input inputMode="numeric" value={templateId} onChange={(e) => setTemplateId(e.target.value.replace(/[^\d۰-۹]/g, ''))} className={inputCls + ' font-mono'} dir="ltr" />
          </label>
          <label className="text-[11px] font-bold text-slate-600 space-y-1">عبارت cron
            <input value={cron} onChange={(e) => setCron(e.target.value)} className={inputCls + ' font-mono'} dir="ltr" />
          </label>
          <label className="text-[11px] font-bold text-slate-600 space-y-1 sm:col-span-2 lg:col-span-2">شماره آزمایشی (خالی = بدون تغییر)
            <input value={testMobile} onChange={(e) => setTestMobile(e.target.value.replace(/[^\d۰-۹+]/g, ''))} className={inputCls + ' font-mono'} dir="ltr" placeholder="09xxxxxxxxx" />
          </label>
          <div className="sm:col-span-2 lg:col-span-2 flex items-end gap-2">
            <button disabled={busy} onClick={save} className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-xs font-bold">ذخیره تنظیمات</button>
            <button disabled={busy} onClick={reloadPreview} className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">به‌روزرسانی پیش‌نمایش</button>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 flex items-center justify-between">
            <span className="text-[11px] font-black text-slate-700">پیش‌نمایش (تاریخ هدف: <span className="font-mono">{preview?.target_date || '—'}</span>)</span>
            <span className="text-[11px] text-slate-500">قابل ارسال: {fa(preview?.would_send || 0)} از {fa(preview?.total || 0)}</span>
          </div>
          {!preview || preview.items.length === 0 ? (
            <div className="text-xs text-slate-400 py-6 text-center">موردی برای تاریخ هدف پیدا نشد.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] text-right">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  {['قسط', 'کارآموز', 'همراه', 'مبلغ', 'سررسید', 'وضعیت'].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {preview.items.map((it) => (
                    <tr key={it.installment_id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono">#{fa(it.installment_id)}</td>
                      <td className="px-3 py-2">{it.name_masked || '—'}</td>
                      <td className="px-3 py-2 font-mono" dir="ltr">{it.mobile_masked || '—'}</td>
                      <td className="px-3 py-2 font-bold">{it.amount_text}</td>
                      <td className="px-3 py-2 font-mono">{it.due_date}</td>
                      <td className="px-3 py-2">
                        {it.would_send
                          ? <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="w-3.5 h-3.5" />قابل ارسال</span>
                          : <span className="inline-flex items-center gap-1 text-slate-500"><XCircle className="w-3.5 h-3.5" />{REASON_LABEL[it.reason] || it.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {preview && preview.items.length > 0 && (
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            نمونه متن (متن نهایی از قالب sms.ir می‌آید): <span className="text-slate-700">{preview.items[0].text_preview}</span>
          </div>
        )}

        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-black text-slate-700"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" />اجرای دستی (فقط وقتی فعال باشد)</div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="برای تأیید «ارسال» را تایپ کنید" className={inputCls + ' max-w-xs'} />
            <button disabled={busy || confirmText !== 'ارسال'} onClick={runNow} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-xl"><Send className="w-3.5 h-3.5" />اجرای آزمایشی</button>
          </div>
          <p className="text-[10px] text-slate-400">اجرای آزمایشی هیچ پیامکی نمی‌فرستد و فقط یک ردیف «آزمایشی» ثبت می‌کند.</p>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 text-[11px] font-black text-slate-700">گزارش ارسال</div>
          {log.length === 0 ? <div className="text-xs text-slate-400 py-6 text-center">گزارشی ثبت نشده است.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] text-right">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  {['قسط', 'روز', 'همراه', 'وضعیت', 'شناسه پیام', 'خطا', 'زمان'].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono">#{fa(r.installment_id)}</td>
                      <td className="px-3 py-2 font-mono">{r.send_day}</td>
                      <td className="px-3 py-2 font-mono" dir="ltr">{r.mobile_masked || '—'}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full border font-bold ${LOG_STYLE[r.status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>{LOG_LABEL[r.status] || r.status}</span></td>
                      <td className="px-3 py-2 font-mono text-slate-500">{r.provider_message_id || '—'}</td>
                      <td className="px-3 py-2 text-rose-600">{r.error || '—'}</td>
                      <td className="px-3 py-2 font-mono text-slate-400">{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
