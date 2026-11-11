// «تنظیمات > درگاه پرداخت»: Zarinpal settings (admin only). Secrets are write-only: the server only returns
// the last 4 chars of the merchant id and whether an access token is set.
import React, { useEffect, useState } from 'react';
import { CreditCard, RefreshCw, Save, CheckCircle, AlertCircle, Wifi, Download } from 'lucide-react';
import * as zp from '../api/zarinpalSettings';

const SOURCE_LABEL: Record<zp.ZpSource, string> = { saved: 'ذخیره‌شده در تنظیمات', env: 'از فایل .env سرور', default: 'پیش‌فرض' };
const STATUS_VIEW: Record<zp.ZarinpalSettingsView['status'], { text: string; cls: string }> = {
  not_configured: { text: 'تنظیم نشده', cls: 'text-slate-600 bg-slate-100 border-slate-200' },
  invalid_merchant: { text: 'کد مرچنت نامعتبر', cls: 'text-rose-700 bg-rose-50 border-rose-200' },
  sandbox: { text: 'فعال — حالت تست (sandbox)', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  live: { text: 'فعال — پرداخت واقعی', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
};
const SESSION_STATUS: Record<string, string> = { PAID: 'پرداخت‌شده', VERIFIED: 'موفق (تأییدشده)', FAILED: 'ناموفق', IN_BANK: 'در بانک', INBANK: 'در بانک', REVERSED: 'برگشت‌خورده', TRASH: 'ناموفق' };
const fmtToman = (n: number) => `${(Number(n) || 0).toLocaleString('fa-IR')} تومان`;
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const inputCls = 'w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400';

export default function ZarinpalGatewayPanel() {
  const [view, setView] = useState<zp.ZarinpalSettingsView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [merchant, setMerchant] = useState('');
  const [token, setToken] = useState('');
  const [sandbox, setSandbox] = useState(true);
  const [currency, setCurrency] = useState<'IRR' | 'IRT'>('IRR');
  const [publicBase, setPublicBase] = useState('');
  const [linkBase, setLinkBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<zp.ZpTestResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [tx, setTx] = useState<zp.ZpTransactions | null>(null);
  const [page, setPage] = useState(0);
  const PAGE = 50;

  const apply = (v: zp.ZarinpalSettingsView) => {
    setView(v); setSandbox(v.sandbox); setCurrency(v.currency); setPublicBase(v.public_base_url); setLinkBase(v.payment_link_base);
  };
  useEffect(() => { zp.getZarinpalSettings().then(apply).catch((e) => setLoadError(e?.message || 'خطا در دریافت تنظیمات')); }, []);

  const save = async (extra: zp.ZarinpalSettingsPatch = {}) => {
    setSaving(true); setMsg(null);
    try {
      // Only send what the admin changed (or what is already saved), so env-based values stay env-based.
      const v = view!;
      const patch: zp.ZarinpalSettingsPatch = { ...extra };
      if (v.sources.sandbox === 'saved' || sandbox !== v.sandbox) patch.sandbox = sandbox;
      if (v.sources.currency === 'saved' || currency !== v.currency) patch.currency = currency;
      if (v.sources.public_base_url === 'saved' || publicBase !== v.public_base_url) patch.public_base_url = publicBase;
      if (v.sources.payment_link_base === 'saved' || linkBase !== v.payment_link_base) patch.payment_link_base = linkBase;
      if (merchant.trim()) patch.merchant_id = merchant.trim();
      if (token.trim()) patch.access_token = token.trim();
      const r = await zp.saveZarinpalSettings(patch);
      apply(r.settings); setMerchant(''); setToken('');
      setMsg({ ok: true, text: 'تنظیمات درگاه پرداخت ذخیره شد' });
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'ذخیره ناموفق بود' }); }
    finally { setSaving(false); }
  };
  const runTest = async () => {
    setTesting(true); setTest(null);
    try { const r = await zp.testZarinpal(); setTest(r); apply(r.settings); }
    catch (e: any) { setTest({ merchant: { ok: false, message: e?.message || 'خطا' }, api: { ok: false, message: '' }, settings: view! }); }
    finally { setTesting(false); }
  };
  const sync = async (terminalId?: string) => {
    setSyncing(true); setSyncError('');
    try { setTx(await zp.fetchZarinpalTransactions({ terminal_id: terminalId })); setPage(0); }
    catch (e: any) { setSyncError(e?.message || 'همگام‌سازی ناموفق بود'); }
    finally { setSyncing(false); }
  };

  if (loadError) return <div role="alert" className="text-xs font-bold text-rose-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{loadError}</div>;
  if (!view) return <div className="text-xs text-slate-400 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" />در حال بارگذاری...</div>;
  const st = STATUS_VIEW[view.status];
  const src = (k: keyof zp.ZarinpalSettingsView['sources']) => <span className="text-[10px] text-slate-400 font-normal mr-1">({SOURCE_LABEL[view.sources[k]]})</span>;

  return (
    <div dir="rtl" className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><CreditCard className="w-4 h-4 text-emerald-600" />درگاه پرداخت زرین‌پال</h3>
        <span className={`text-[11px] font-bold px-2 py-1 rounded-md border ${st.cls}`}>{st.text}</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-6">
        مقادیری که اینجا ذخیره شوند بر مقدارهای فایل <bdi dir="ltr">.env</bdi> سرور اولویت دارند؛ اگر خالی بمانند، همان مقدار <bdi dir="ltr">.env</bdi> استفاده می‌شود.
        کد مرچنت و توکن دسترسی هیچ‌وقت به مرورگر برنمی‌گردند.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">کد مرچنت (Merchant ID){src('merchant_id')}</label>
            {view.merchant_id_set && <div className="text-[11px] mb-1 text-slate-600">مقدار فعلی: <bdi dir="ltr" className="font-mono">{view.merchant_id_masked}</bdi> {view.merchant_id_valid ? <span className="text-emerald-600">✓</span> : <span className="text-rose-600">(قالب نامعتبر)</span>}</div>}
            <input type="password" autoComplete="off" dir="ltr" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={merchant} onChange={e => setMerchant(e.target.value)} className={inputCls} />
            {view.sources.merchant_id === 'saved' && <button type="button" onClick={() => save({ clear_merchant_id: true })} className="mt-1 text-[10px] text-rose-600 hover:underline cursor-pointer">حذف مقدار ذخیره‌شده (برگشت به .env)</button>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">توکن دسترسی API (Access Token){src('access_token')}</label>
            <div className="text-[11px] mb-1">{view.access_token_set ? <span className="text-emerald-600 font-bold">تنظیم شده</span> : <span className="text-slate-500">تنظیم نشده</span>} <span className="text-slate-400">— برای تغییر، مقدار جدید را وارد کنید.</span></div>
            <input type="password" autoComplete="off" dir="ltr" value={token} onChange={e => setToken(e.target.value)} className={inputCls} />
            {view.sources.access_token === 'saved' && <button type="button" onClick={() => save({ clear_access_token: true })} className="mt-1 text-[10px] text-rose-600 hover:underline cursor-pointer">حذف توکن ذخیره‌شده (برگشت به .env)</button>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 cursor-pointer">
              <input type="checkbox" className="accent-amber-600" checked={sandbox} onChange={e => setSandbox(e.target.checked)} />
              حالت تست (sandbox){src('sandbox')}
            </label>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">واحد پول ارسالی{src('currency')}</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as 'IRR' | 'IRT')} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white cursor-pointer">
                <option value="IRR">ریال (IRR)</option>
                <option value="IRT">تومان (IRT)</option>
              </select>
            </div>
          </div>
          {!sandbox && <div className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">با خاموش کردن حالت تست، پرداخت‌ها واقعی می‌شوند.</div>}
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">آدرس عمومی CRM (PUBLIC_BASE_URL){src('public_base_url')}</label>
            <input type="url" dir="ltr" placeholder="https://management.kermanshahcart.ir" value={publicBase} onChange={e => setPublicBase(e.target.value)} className={inputCls} />
            <p className="text-[10px] text-slate-400 mt-1">برای آدرس بازگشت از درگاه استفاده می‌شود.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">پایه لینک پرداخت (CRM_PAYMENT_LINK_BASE){src('payment_link_base')}</label>
            <input type="url" dir="ltr" placeholder="https://kermanshahcart.ir/p/" value={linkBase} onChange={e => setLinkBase(e.target.value)} className={inputCls} />
            <p className="text-[10px] text-slate-400 mt-1">کد لینک به انتهای آن اضافه می‌شود؛ معمولاً با <bdi dir="ltr">/p/</bdi> تمام می‌شود.</p>
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-wrap gap-2 items-center pt-3 border-t border-slate-100">
          <button type="button" onClick={runTest} disabled={testing} className="px-4 py-2 text-xs font-bold rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white cursor-pointer flex items-center gap-1.5">
            {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}تست اتصال
          </button>
          {test && (
            <span className="flex flex-col gap-1 text-[11px] font-bold">
              <span className={test.merchant.ok ? 'text-emerald-700' : 'text-rose-700'}>مرچنت: {test.merchant.message}</span>
              {test.api.message && <span className={test.api.ok ? 'text-emerald-700' : test.api.skipped ? 'text-slate-500' : 'text-rose-700'}>API: {test.api.message}</span>}
            </span>
          )}
          {msg && <span role={msg.ok ? undefined : 'alert'} className={`text-xs font-bold flex items-center gap-1 ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.ok && <CheckCircle className="w-4 h-4" />}{msg.text}</span>}
          <button type="submit" disabled={saving} className="mr-auto px-5 py-2.5 bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
            {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />ذخیره...</> : <><Save className="w-3.5 h-3.5" />ذخیره درگاه پرداخت</>}
          </button>
        </div>
      </form>

      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-bold text-slate-800">تراکنش‌های زرین‌پال</h4>
          <span className="text-[10px] text-slate-400">فقط خواندنی — چیزی در زرین‌پال یا CRM تغییر نمی‌کند.</span>
          <button type="button" onClick={() => sync(tx?.terminal_id || undefined)} disabled={syncing || !view.access_token_set} className="mr-auto px-4 py-2 text-xs font-bold rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer flex items-center gap-1.5">
            {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}همگام‌سازی تراکنش‌های زرین‌پال
          </button>
        </div>
        {!view.access_token_set && <p className="text-[11px] text-slate-500">برای همگام‌سازی ابتدا توکن دسترسی را ذخیره کنید.</p>}
        {syncError && <p role="alert" className="text-[11px] font-bold text-rose-600">{syncError}</p>}
        {tx && (
          <>
            {tx.terminals.length > 1 && (
              <select value={tx.terminal_id || ''} onChange={e => sync(e.target.value)} className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white cursor-pointer">
                {tx.terminals.map(t => <option key={t.id} value={t.id}>{t.name || t.domain || t.id} ({t.domain}){t.matches_merchant ? ' — مرچنت فعلی' : ''}</option>)}
              </select>
            )}
            {tx.terminals.length === 1 && <p className="text-[11px] text-slate-500">درگاه: <bdi dir="ltr">{tx.terminals[0].domain}</bdi> — {tx.terminals[0].status}{tx.terminals[0].matches_merchant ? ' (همان مرچنت تنظیم‌شده)' : ''}</p>}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-bold text-slate-700">مجموع: {tx.total.toLocaleString('fa-IR')} تراکنش</span>
              {Object.entries(tx.by_status).map(([k, n]) => <span key={k} className="px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-slate-600">{SESSION_STATUS[k] || k}: {n.toLocaleString('fa-IR')}</span>)}
              {tx.truncated && <span className="text-amber-700">(فقط بخشی از تراکنش‌ها دریافت شد)</span>}
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2 font-bold">تاریخ</th><th className="p-2 font-bold">مبلغ</th><th className="p-2 font-bold">وضعیت</th>
                    <th className="p-2 font-bold">توضیحات</th><th className="p-2 font-bold">شماره مرجع (RRN)</th><th className="p-2 font-bold">کارت</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.sessions.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">تراکنشی یافت نشد.</td></tr>}
                  {tx.sessions.slice(page * PAGE, (page + 1) * PAGE).map(s => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="p-2 whitespace-nowrap">{fmtDate(s.created_at)}</td>
                      <td className="p-2 whitespace-nowrap font-bold">{fmtToman(s.amount_toman)}</td>
                      <td className="p-2 whitespace-nowrap">{SESSION_STATUS[s.status] || s.status}</td>
                      <td className="p-2 max-w-[260px] truncate" title={s.description}>{s.description}</td>
                      <td className="p-2 font-mono" dir="ltr">{s.rrn || '—'}</td>
                      <td className="p-2 font-mono" dir="ltr">{s.card || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tx.total > PAGE && (
              <div className="flex items-center gap-2 text-[11px]">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer">قبلی</button>
                <button type="button" disabled={(page + 1) * PAGE >= tx.total} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer">بعدی</button>
                <span className="text-slate-400">ردیف {(page * PAGE + 1).toLocaleString('fa-IR')} تا {Math.min(tx.total, (page + 1) * PAGE).toLocaleString('fa-IR')}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
