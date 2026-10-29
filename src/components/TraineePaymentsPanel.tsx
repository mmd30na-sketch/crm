import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Upload, Loader2, CheckCircle2, XCircle, Wallet, LogOut, GraduationCap, RefreshCw } from 'lucide-react';
import * as op from '../api/onlinePayments';

const toEn = (v: string) => String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
const digitsOnly = (v: string) => toEn(v).replace(/\D/g, '');
const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200';

const STATUS_STYLE: Record<op.OnlineStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-sky-50 text-sky-700 border-sky-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

function OutcomeBanner({ outcome }: { outcome: string }) {
  if (!outcome) return null;
  const ok = outcome === 'ok';
  const msg = ok
    ? 'پرداخت شما با موفقیت در درگاه انجام شد و پس از تأیید آموزشگاه در حساب شما ثبت می‌شود.'
    : outcome === 'notfound'
      ? 'تراکنش مورد نظر پیدا نشد. اگر مبلغی کسر شده با آموزشگاه تماس بگیرید.'
      : 'پرداخت کامل نشد یا لغو شد. می‌توانید دوباره تلاش کنید.';
  return (
    <div className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 border ${ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span>{msg}</span>
    </div>
  );
}

export default function TraineePaymentsPanel({ token, code }: { token: string; code?: string }) {
  const [activeToken, setActiveToken] = useState(token || '');
  const [linkCode] = useState(code || '');
  const [linkInfo, setLinkInfo] = useState<op.TraineeLinkInfo | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [me, setMe] = useState<op.TraineeMe | null>(null);
  const [payments, setPayments] = useState<op.TraineePayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [receiptFor, setReceiptFor] = useState<number | null>(null);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [loginId, setLoginId] = useState('');
  const [loginLast4, setLoginLast4] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const outcome = useMemo(() => new URLSearchParams(window.location.search).get('payment') || '', []);

  const load = useCallback(async (tok: string) => {
    setLoading(true); setErr(null);
    try {
      const [meRes, payRes] = await Promise.all([op.traineeMe(tok), op.traineePayments(tok)]);
      setMe(meRes);
      setPayments(payRes);
      setAmounts((prev) => {
        const next = { ...prev };
        for (const e of meRes.enrollments) if (next[e.id] === undefined) next[e.id] = String(e.remaining);
        return next;
      });
    } catch (e: any) {
      setErr(e.message);
      if (/نامعتبر|منقضی/.test(e.message || '')) { try { const u = new URL(window.location.href); u.searchParams.delete('t'); window.history.replaceState(null, '', u.pathname + (u.search || '')); } catch {} setActiveToken(''); setMe(null); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (activeToken) void load(activeToken); }, [activeToken, load]);

  useEffect(() => {
    if (!linkCode || activeToken) return;
    setLinkLoading(true); setLinkErr(null);
    op.traineeLinkInfo(linkCode).then(setLinkInfo).catch((e: any) => setLinkErr(e.message)).finally(() => setLinkLoading(false));
  }, [linkCode, activeToken]);

  const payLink = async () => {
    setLinkBusy(true); setLinkErr(null);
    try {
      const r = await op.traineeLinkZarinpal(linkCode);
      window.location.href = r.payment_url;
    } catch (e: any) { setLinkErr(e.message); setLinkBusy(false); }
  };

  const persistToken = (tok: string) => {
    setActiveToken(tok);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('trainee', '1'); u.searchParams.set('t', tok); u.searchParams.delete('payment');
      window.history.replaceState(null, '', u.pathname + (u.search || ''));
    } catch {}
  };

  const logout = () => {
    setActiveToken(''); setMe(null); setPayments([]); setErr(null); setNotice(null);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('t'); u.searchParams.delete('payment'); u.searchParams.set('trainee', '1');
      window.history.replaceState(null, '', u.pathname + (u.search || ''));
    } catch {}
  };

  const login = async () => {
    setErr(null);
    const id = Number(digitsOnly(loginId));
    const last4 = digitsOnly(loginLast4).slice(-4);
    if (!id || last4.length !== 4) { setErr('شناسه کارآموز و ۴ رقم آخر کد ملی را وارد کنید.'); return; }
    setLoginBusy(true);
    try {
      const r = await op.traineeLogin(id, last4);
      persistToken(r.token);
    } catch (e: any) { setErr(e.message); } finally { setLoginBusy(false); }
  };

  const payOnline = async (enrollmentId: number, remaining: number) => {
    const amount = Math.round(Number(digitsOnly(amounts[enrollmentId] ?? '')));
    if (!Number.isFinite(amount) || amount <= 0) { setErr('مبلغ را درست وارد کنید.'); return; }
    if (amount > remaining) { setErr('مبلغ از مانده این دوره بیشتر است.'); return; }
    setBusy(enrollmentId); setErr(null); setNotice(null);
    try {
      const r = await op.traineeZarinpalRequest(activeToken, { enrollment_id: enrollmentId, amount });
      window.location.href = r.payment_url;
    } catch (e: any) { setErr(e.message); setBusy(null); }
  };

  const submitReceipt = async () => {
    if (!receiptFor) return;
    const enrollment = me?.enrollments.find((e) => e.id === receiptFor);
    const amount = Math.round(Number(digitsOnly(receiptAmount)));
    if (!enrollment) return;
    if (!receiptFile) { setErr('فایل رسید را انتخاب کنید.'); return; }
    if (!Number.isFinite(amount) || amount <= 0 || amount > enrollment.remaining) { setErr('مبلغ معتبر نیست.'); return; }
    setBusy(receiptFor); setErr(null); setNotice(null);
    try {
      await op.traineeUploadReceipt(activeToken, { enrollment_id: receiptFor, amount, file: receiptFile });
      setReceiptFor(null); setReceiptFile(null); setReceiptAmount('');
      setNotice('رسید شما ثبت شد و پس از بررسی آموزشگاه در حساب اعمال می‌شود.');
      await load(activeToken);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  const totalRemaining = (me?.enrollments || []).reduce((s, e) => s + (Number(e.remaining) || 0), 0);

  return (
    <div className="min-h-screen h-[100dvh] overflow-y-auto bg-slate-50" dir="rtl">
      <header className="sticky top-0 z-10 bg-slate-900 text-white px-4 py-3.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-500 flex items-center justify-center"><GraduationCap className="w-5 h-5" /></div>
          <div>
            <div className="text-sm font-bold leading-tight">پرداخت اقساط کارآموز</div>
            <div className="text-[10px] text-slate-400 leading-tight">آموزشگاه همتراز</div>
          </div>
        </div>
        {activeToken && <button type="button" onClick={logout} className="min-h-10 px-2 text-xs text-slate-300 hover:text-white flex items-center gap-1"><LogOut className="w-4 h-4" />خروج</button>}
      </header>

      <main className="max-w-2xl mx-auto p-3 sm:p-5 space-y-4">
        <OutcomeBanner outcome={outcome} />

        {linkCode && !activeToken ? (
          linkLoading && !linkInfo ? (
            <div className="text-xs text-slate-400 py-16 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>
          ) : linkErr && !linkInfo ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 text-center">
              <XCircle className="w-8 h-8 text-rose-400 mx-auto" />
              <p role="alert" className="text-xs text-rose-700">{linkErr}</p>
            </div>
          ) : linkInfo ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="text-center space-y-1">
                <div className="text-sm font-black text-slate-800">{linkInfo.kind === 'debt' ? 'پرداخت مانده بدهی' : 'پرداخت قسط'}</div>
                <div className="text-[11px] text-slate-500">{[linkInfo.student.first_name, linkInfo.student.last_name].filter(Boolean).join(' ')} · <span className="font-mono" dir="ltr">{linkInfo.student.phone_masked}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-slate-50 rounded-xl py-3"><div className="text-[10px] text-slate-400">مبلغ قابل پرداخت</div><div className="text-base font-black text-slate-800">{fa(linkInfo.amount)} <span className="text-[10px] font-normal">تومان</span></div></div>
                {linkInfo.kind === 'debt' ? (
                  <div className="bg-slate-50 rounded-xl py-3"><div className="text-[10px] text-slate-400">مانده کل</div><div className="text-sm font-black text-slate-800">{fa(linkInfo.debt_total ?? linkInfo.amount)} <span className="text-[10px] font-normal">تومان</span></div></div>
                ) : (
                  <div className="bg-slate-50 rounded-xl py-3"><div className="text-[10px] text-slate-400">سررسید</div><div className="text-sm font-black text-slate-800 font-mono">{linkInfo.due_date_jalali}</div></div>
                )}
              </div>
              {linkInfo.paid ? (
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl py-3"><CheckCircle2 className="w-4 h-4" />{linkInfo.kind === 'debt' ? 'مانده بدهی شما تسویه شده است.' : 'این قسط قبلاً پرداخت شده است.'}</div>
              ) : linkInfo.kind === 'installment' && linkInfo.installment && linkInfo.installment.status !== 'unpaid' ? (
                <div className="text-center text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl py-3">این قسط قابل پرداخت نیست.</div>
              ) : (
                <button disabled={linkBusy} onClick={payLink} className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-sm font-bold flex items-center justify-center gap-2">
                  {linkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}پرداخت در درگاه بانکی
                </button>
              )}
              {linkErr && linkInfo && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{linkErr}</p>}
              {linkInfo.expires_at && <p className="text-[10px] text-slate-400 text-center">اعتبار این لینک تا <span className="font-mono">{linkInfo.expires_at.slice(0, 16).replace('T', ' ')}</span></p>}
            </div>
          ) : null
        ) : !activeToken ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <h1 className="text-sm font-black text-slate-800">ورود با شماره پرونده</h1>
            <p className="text-xs text-slate-500">شناسه کارآموز و ۴ رقم آخر کد ملی خود را وارد کنید.</p>
            <label className="block text-xs font-bold text-slate-600 space-y-1">شناسه کارآموز
              <input inputMode="numeric" value={loginId} onChange={(e) => setLoginId(digitsOnly(e.target.value))} className={inputCls} placeholder="مثلاً ۱۱۸" />
            </label>
            <label className="block text-xs font-bold text-slate-600 space-y-1">۴ رقم آخر کد ملی
              <input inputMode="numeric" dir="ltr" maxLength={4} value={loginLast4} onChange={(e) => setLoginLast4(digitsOnly(e.target.value).slice(0, 4))} className={inputCls + ' text-center font-mono tracking-widest'} placeholder="----" />
            </label>
            {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}
            <button disabled={loginBusy} onClick={login} className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-sm font-bold flex items-center justify-center gap-2">
              {loginBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}ورود
            </button>
          </div>
        ) : loading && !me ? (
          <div className="text-xs text-slate-400 py-16 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>
        ) : (
          <>
            {me && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-800 truncate">{[me.student.first_name, me.student.last_name].filter(Boolean).join(' ')}</div>
                  <div className="text-[11px] text-slate-400 font-mono" dir="ltr">{me.student.phone_masked}</div>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-[10px] text-slate-400">مانده کل</div>
                  <div className={`text-sm font-black ${totalRemaining > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fa(totalRemaining)} تومان</div>
                </div>
                <button onClick={() => load(activeToken)} className="p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50" aria-label="به‌روزرسانی"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
              </div>
            )}

            {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}
            {notice && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}

            <div className="space-y-3">
              {(me?.enrollments || []).map((e) => {
                const remaining = Number(e.remaining) || 0;
                return (
                  <div key={e.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-black text-slate-800 text-sm truncate">{e.course_title || `دوره #${e.course_id}`}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">دوره شماره {e.course_number ? fa(e.course_number) : '—'}{e.signup_date_jalali ? ` · ثبت‌نام ${e.signup_date_jalali}` : ''}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${remaining > 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{remaining > 0 ? 'بدهکار' : 'تسویه'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center mt-3">
                      <div className="bg-slate-50 rounded-xl py-2"><div className="text-[10px] text-slate-400">شهریه</div><div className="text-xs font-black">{fa(e.final_price)}</div></div>
                      <div className="bg-emerald-50 rounded-xl py-2"><div className="text-[10px] text-emerald-600">پرداختی</div><div className="text-xs font-black text-emerald-700">{fa(Math.max(0, e.final_price - remaining))}</div></div>
                      <div className={`${remaining > 0 ? 'bg-rose-50' : 'bg-slate-50'} rounded-xl py-2`}><div className="text-[10px] text-slate-400">مانده</div><div className={`text-xs font-black ${remaining > 0 ? 'text-rose-700' : ''}`}>{fa(remaining)}</div></div>
                    </div>

                    {remaining > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input inputMode="numeric" value={amounts[e.id] ?? ''} onChange={(ev) => setAmounts({ ...amounts, [e.id]: digitsOnly(ev.target.value) })} className={inputCls + ' text-center font-mono'} placeholder="مبلغ (تومان)" />
                          <span className="text-[10px] text-slate-400 shrink-0">حداکثر {fa(remaining)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button disabled={busy === e.id} onClick={() => payOnline(e.id, remaining)} className="flex items-center justify-center gap-1 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 rounded-xl">
                            {busy === e.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}پرداخت آنلاین
                          </button>
                          <button disabled={busy === e.id} onClick={() => { setReceiptFor(e.id); setReceiptAmount(amounts[e.id] ?? String(remaining)); setReceiptFile(null); setErr(null); }} className="flex items-center justify-center gap-1 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl">
                            <Upload className="w-4 h-4" />ارسال رسید
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {me && me.enrollments.length === 0 && <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-8 text-center">ثبت‌نامی برای شما پیدا نشد.</div>}
            </div>

            {payments.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
                <h2 className="text-xs font-black text-slate-700">پرداخت‌های ثبت‌شده</h2>
                <ul className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <li key={p.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-700">{fa(p.amount)} تومان · {op.ONLINE_METHOD_LABEL[p.method]}</div>
                        <div className="text-[10px] text-slate-400">{p.created_at?.slice(0, 16).replace('T', ' ')}{p.ref_id ? ` · کد پیگیری ${p.ref_id}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.has_receipt && <a href={op.traineeReceiptUrl(activeToken, p.id)} target="_blank" rel="noreferrer" className="inline-block py-1.5 px-1 text-sky-600 text-xs font-bold hover:underline">رسید</a>}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[p.status]}`}>{op.ONLINE_STATUS_LABEL[p.status]}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>

      {receiptFor && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setReceiptFor(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black">ارسال رسید پرداخت</h3>
            <label className="block text-xs font-bold text-slate-600 space-y-1">مبلغ (تومان)
              <input inputMode="numeric" value={receiptAmount} onChange={(e) => setReceiptAmount(digitsOnly(e.target.value))} className={inputCls + ' text-center font-mono'} />
            </label>
            <label className="block text-xs font-bold text-slate-600 space-y-1">فایل رسید (تصویر یا PDF، حداکثر ۸ مگابایت)
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="block w-full text-xs file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-sky-50 file:text-sky-700 file:font-bold" />
            </label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button disabled={busy === receiptFor} onClick={submitReceipt} className="py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-sm font-bold">{busy === receiptFor ? 'در حال ارسال...' : 'ثبت رسید'}</button>
              <button onClick={() => setReceiptFor(null)} className="py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">انصراف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
