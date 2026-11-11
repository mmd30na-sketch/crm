// «تنظیمات هم‌راز»: settings group for the CRM's AI copilot (هم‌راز). Sub-sections: payment gateway
// (Zarinpal) and the editable copilot settings (saved > .env > default, applied without a restart).
import React, { useEffect, useState } from 'react';
import { Bot, CreditCard, RefreshCw, CheckCircle, AlertCircle, Save, Wifi } from 'lucide-react';
import ZarinpalGatewayPanel from './ZarinpalGatewayPanel';
import * as zp from '../api/zarinpalSettings';

type Sub = 'payment' | 'copilot';
const SUBS: { id: Sub; label: string; icon: typeof Bot }[] = [
  { id: 'payment', label: 'درگاه پرداخت', icon: CreditCard },
  { id: 'copilot', label: 'دستیار هم‌راز', icon: Bot },
];
const SOURCE_LABEL: Record<string, string> = { saved: 'ذخیره‌شده', env: '.env سرور', default: 'پیش‌فرض' };
const inputCls = 'w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400';

function Toggle({ label, checked, onChange, hint, src }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; src?: string }) {
  return (
    <label className="flex items-start gap-2 text-[11px] font-semibold text-slate-700 cursor-pointer py-1">
      <input type="checkbox" className="accent-sky-600 mt-0.5" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}{src && <span className="text-[10px] text-slate-400 font-normal mr-1">({SOURCE_LABEL[src] || src})</span>}{hint && <span className="block text-[10px] text-slate-400 font-normal">{hint}</span>}</span>
    </label>
  );
}

function CopilotSettingsForm() {
  const [v, setV] = useState<zp.HamrazSettingsView | null>(null);
  const [err, setErr] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [steps, setSteps] = useState(6);
  const [sql, setSql] = useState(false);
  const [smsDirect, setSmsDirect] = useState(true);
  const [confirm, setConfirm] = useState<Record<zp.HamrazConfirmKey, boolean>>({ sms_send: true, telegram: true, rubika: true });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const apply = (x: zp.HamrazSettingsView) => {
    setV(x); setEnabled(x.enabled); setApiUrl(x.api_url); setModel(x.model); setSteps(x.max_iterations);
    setSql(x.sql_enabled); setSmsDirect(x.sms_direct); setConfirm({ ...x.confirm });
  };
  useEffect(() => { zp.getHamrazSettings().then(apply).catch((e) => setErr(e?.message || 'خطا در دریافت تنظیمات')); }, []);

  const save = async (extra: zp.HamrazPatch = {}) => {
    if (!v) return;
    setSaving(true); setMsg(null);
    try {
      // Only changed (or already saved) fields are sent, so env-based values stay env-based.
      const p: zp.HamrazPatch = { ...extra };
      const keep = (k: string, changed: boolean) => v.sources[k] === 'saved' || changed;
      if (keep('enabled', enabled !== v.enabled)) p.enabled = enabled;
      if (apiUrl !== v.api_url) p.api_url = apiUrl; // the view URL is redacted, so never echo it back unchanged
      if (keep('model', model !== v.model)) p.model = model;
      if (keep('max_iterations', steps !== v.max_iterations)) p.max_iterations = steps;
      if (keep('sql_enabled', sql !== v.sql_enabled)) p.sql_enabled = sql;
      if (keep('sms_direct', smsDirect !== v.sms_direct)) p.sms_direct = smsDirect;
      const c: Partial<Record<zp.HamrazConfirmKey, boolean>> = {};
      (['sms_send', 'telegram', 'rubika'] as const).forEach((k) => { if (keep(k, confirm[k] !== v.confirm[k])) c[k] = confirm[k]; });
      if (Object.keys(c).length) p.confirm = c;
      if (apiKey.trim()) p.api_key = apiKey.trim();
      const r = await zp.saveHamrazSettings(p);
      apply(r.settings); setApiKey('');
      setMsg({ ok: true, text: 'تنظیمات هم‌راز ذخیره شد و بدون ری‌استارت اعمال می‌شود' });
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'ذخیره ناموفق بود' }); }
    finally { setSaving(false); }
  };
  const runTest = async () => {
    setTesting(true); setTest(null);
    try { const r = await zp.testHamraz(); setTest({ ok: r.ok, text: `${r.message}${r.ok ? ` (${r.model}، ${r.ms.toLocaleString('fa-IR')} میلی‌ثانیه)` : ''}` }); }
    catch (e: any) { setTest({ ok: false, text: e?.message || 'خطا' }); }
    finally { setTesting(false); }
  };

  if (err) return <div role="alert" className="text-xs font-bold text-rose-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{err}</div>;
  if (!v) return <div className="text-xs text-slate-400 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" />در حال بارگذاری...</div>;
  const src = (k: string) => <span className="text-[10px] text-slate-400 font-normal mr-1">({SOURCE_LABEL[v.sources[k]] || v.sources[k]})</span>;
  return (
    <form dir="rtl" onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4 fade-in">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Bot className="w-4 h-4 text-sky-600" />دستیار هم‌راز</h3>
        <span className={`text-[11px] font-bold px-2 py-1 rounded-md border flex items-center gap-1 ${!v.enabled ? 'text-slate-600 bg-slate-100 border-slate-200' : v.configured ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
          {v.enabled && v.configured ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}{!v.enabled ? 'غیرفعال' : v.configured ? 'فعال و پیکربندی‌شده' : 'پیکربندی ناقص'}
        </span>
      </div>
      <p className="text-[11px] text-slate-500 leading-6">مقدارهای ذخیره‌شده بر <bdi dir="ltr">.env</bdi> سرور اولویت دارند و بدون ری‌استارت اعمال می‌شوند. کلید API هیچ‌وقت به مرورگر برنمی‌گردد.</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <Toggle label="هم‌راز فعال باشد" checked={enabled} onChange={setEnabled} src={v.sources.enabled} />
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">آدرس سرویس هوش مصنوعی (OpenAI-compatible){src('api_url')}</label>
            <input type="url" dir="ltr" placeholder="https://host/v1" value={apiUrl} onChange={e => setApiUrl(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">کلید API{src('api_key')}</label>
            <div className="text-[11px] mb-1">{v.api_key_set ? <span className="text-emerald-600 font-bold">تنظیم شده</span> : <span className="text-slate-500">تنظیم نشده</span>} <span className="text-slate-400">— برای تغییر، مقدار جدید را وارد کنید.</span></div>
            <input type="password" autoComplete="off" dir="ltr" value={apiKey} onChange={e => setApiKey(e.target.value)} className={inputCls} />
            {v.sources.api_key === 'saved' && <button type="button" onClick={() => save({ clear_api_key: true })} className="mt-1 text-[10px] text-rose-600 hover:underline cursor-pointer">حذف کلید ذخیره‌شده (برگشت به .env)</button>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">نام مدل{src('model')}</label>
              <input type="text" dir="ltr" value={model} onChange={e => setModel(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">حداکثر گام‌ها{src('max_iterations')}</label>
              <input type="number" min={1} max={20} dir="ltr" value={steps} onChange={e => setSteps(Number(e.target.value) || 1)} className={inputCls} />
            </div>
          </div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1">
          <div className="text-xs font-bold text-slate-800 border-b border-slate-200/60 pb-2 mb-1">ابزارها و ارسال پیام</div>
          <Toggle label="پرس‌وجوی فقط‌خواندنی SQL (فقط مدیر)" checked={sql} onChange={setSql} src={v.sources.sql_enabled} />
          <Toggle label="ارسال مستقیم پیامک به درخواست مدیر (sms_send_direct)" checked={smsDirect} onChange={setSmsDirect} src={v.sources.sms_direct} hint="وقتی مدیر صریحاً «بفرست» بگوید، پیامک همان لحظه ارسال می‌شود." />
          <div className="text-[11px] font-bold text-slate-600 pt-2">نیاز به «تأیید» قبل از ارسال:</div>
          <Toggle label="پیش‌نویس پیامک (sms_send)" checked={confirm.sms_send} onChange={(b) => setConfirm({ ...confirm, sms_send: b })} src={v.sources.sms_send} />
          <Toggle label="تلگرام" checked={confirm.telegram} onChange={(b) => setConfirm({ ...confirm, telegram: b })} src={v.sources.telegram} />
          <Toggle label="روبیکا" checked={confirm.rubika} onChange={(b) => setConfirm({ ...confirm, rubika: b })} src={v.sources.rubika} />
          {(!confirm.sms_send || !confirm.telegram || !confirm.rubika) && <div className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-2">کانال‌هایی که تأییدشان خاموش است، بدون تأیید همان لحظه ارسال می‌شوند.</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-slate-100">
        <button type="button" onClick={runTest} disabled={testing} className="px-4 py-2 text-xs font-bold rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white cursor-pointer flex items-center gap-1.5">
          {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}تست اتصال
        </button>
        <span className="text-[10px] text-slate-400">(تنظیمات ذخیره‌شده را تست می‌کند)</span>
        {test && <span className={`text-[11px] font-bold px-2 py-1 rounded-md break-words ${test.ok ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>{test.text}</span>}
        {msg && <span role={msg.ok ? undefined : 'alert'} className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</span>}
        <button type="submit" disabled={saving} className="mr-auto px-5 py-2.5 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
          {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />ذخیره...</> : <><Save className="w-3.5 h-3.5" />ذخیره تنظیمات هم‌راز</>}
        </button>
      </div>
    </form>
  );
}

export default function HamrazSettingsPanel() {
  const [sub, setSub] = useState<Sub>('payment');
  return (
    <div dir="rtl" className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2 ml-3"><Bot className="w-4 h-4 text-sky-600" />تنظیمات هم‌راز</h2>
        {SUBS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setSub(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border cursor-pointer transition ${sub === id ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>
      {sub === 'payment' ? <ZarinpalGatewayPanel /> : <CopilotSettingsForm />}
    </div>
  );
}
