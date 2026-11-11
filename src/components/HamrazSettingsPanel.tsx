// «تنظیمات هم‌راز»: settings group for the CRM's AI copilot (هم‌راز). Sub-sections: payment gateway
// (Zarinpal) and a read-only copilot status card (the copilot itself is configured through server env).
import React, { useEffect, useState } from 'react';
import { Bot, CreditCard, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import ZarinpalGatewayPanel from './ZarinpalGatewayPanel';
import * as zp from '../api/zarinpalSettings';

type Sub = 'payment' | 'copilot';
const SUBS: { id: Sub; label: string; icon: typeof Bot }[] = [
  { id: 'payment', label: 'درگاه پرداخت', icon: CreditCard },
  { id: 'copilot', label: 'وضعیت دستیار هم‌راز', icon: Bot },
];
const TOOL_LABEL: Record<string, string> = { sms_send: 'پیامک (پیش‌نویس)', send_telegram_message: 'تلگرام', send_rubika_message: 'روبیکا' };

function CopilotStatusCard() {
  const [s, setS] = useState<zp.CopilotStatus | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { zp.getCopilotStatus().then(setS).catch((e) => setErr(e?.message || 'خطا در دریافت وضعیت')); }, []);
  if (err) return <div role="alert" className="text-xs font-bold text-rose-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{err}</div>;
  if (!s) return <div className="text-xs text-slate-400 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" />در حال بارگذاری...</div>;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0 text-xs"><span className="text-slate-500">{k}</span><span className="font-bold text-slate-800">{v}</span></div>
  );
  const yes = (b: boolean, on = 'فعال', off = 'غیرفعال') => <span className={b ? 'text-emerald-700' : 'text-slate-500'}>{b ? on : off}</span>;
  return (
    <div dir="rtl" className="space-y-4 fade-in">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Bot className="w-4 h-4 text-sky-600" />وضعیت دستیار هم‌راز</h3>
        <span className={`text-[11px] font-bold px-2 py-1 rounded-md border flex items-center gap-1 ${s.configured ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
          {s.configured ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}{s.configured ? 'پیکربندی شده' : 'پیکربندی نشده'}
        </span>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-1">
        <Row k="مدل" v={<bdi dir="ltr" className="font-mono">{s.model}</bdi>} />
        <Row k="حداکثر گام‌های ابزار در هر پاسخ" v={s.max_iterations.toLocaleString('fa-IR')} />
        <Row k="پرس‌وجوی فقط‌خواندنی SQL" v={yes(s.sql_enabled)} />
        <Row k="ارسال مستقیم پیامک به درخواست مدیر (sms_send_direct)" v={yes(s.sms_direct)} />
        <Row k="نیازمند تأیید قبل از ارسال" v={s.confirm_required.map((t) => TOOL_LABEL[t] || t).join('، ')} />
      </div>
      <p className="text-[11px] text-slate-500 leading-6">آدرس سرویس، کلید API و مدل هم‌راز از فایل <bdi dir="ltr">.env</bdi> سرور خوانده می‌شوند (<bdi dir="ltr">COPILOT_API_URL</bdi>، <bdi dir="ltr">COPILOT_API_KEY</bdi>، <bdi dir="ltr">COPILOT_MODEL</bdi>) و کلید هیچ‌وقت نمایش داده نمی‌شود.</p>
    </div>
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
      {sub === 'payment' ? <ZarinpalGatewayPanel /> : <CopilotStatusCard />}
    </div>
  );
}
