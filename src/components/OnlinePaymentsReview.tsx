import React, { useCallback, useEffect, useState } from 'react';
import { Wallet, RefreshCw, Loader2, Check, X, Link2, Copy, FileText } from 'lucide-react';
import * as op from '../api/onlinePayments';
import { protectedFileUrl } from '../api/client';

const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');

const STATUS_STYLE: Record<op.OnlineStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-sky-50 text-sky-700 border-sky-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

const FILTERS: Array<{ id: op.OnlineStatus | ''; label: string }> = [
  { id: 'pending', label: 'در انتظار بررسی' },
  { id: 'paid', label: 'پرداخت‌شده' },
  { id: 'approved', label: 'تأییدشده' },
  { id: 'rejected', label: 'ردشده' },
  { id: '', label: 'همه' },
];

export default function OnlinePaymentsReview() {
  const [status, setStatus] = useState<op.OnlineStatus | ''>('pending');
  const [rows, setRows] = useState<op.OnlinePaymentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [linkId, setLinkId] = useState('');
  const [link, setLink] = useState<{ url: string; student_name: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    op.listOnlinePayments(status).then(setRows).catch((e) => { setErr(e.message); setRows([]); });
  }, [status]);
  useEffect(load, [load]);

  const approve = async (row: op.OnlinePaymentRow) => {
    setBusy(row.id); setErr(null);
    try { await op.approveOnlinePayment(row.id); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const reject = async () => {
    if (!noteFor) return;
    setBusy(noteFor); setErr(null);
    try { await op.rejectOnlinePayment(noteFor, note); setNoteFor(null); setNote(''); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const makeLink = async () => {
    const id = Number(String(linkId).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/\D/g, ''));
    if (!id) { setErr('شناسه کارآموز را وارد کنید.'); return; }
    setLinkBusy(true); setErr(null); setCopied(false);
    try { setLink(await op.createTraineeLink(id)); }
    catch (e: any) { setErr(e.message); setLink(null); } finally { setLinkBusy(false); }
  };
  const copyLink = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };

  const PendingActions = ({ row }: { row: op.OnlinePaymentRow }) => (
    <div className="flex items-center gap-1.5">
      <button disabled={busy === row.id || row.status === 'approved' || row.status === 'rejected'} onClick={() => approve(row)} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg">
        {busy === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}تأیید
      </button>
      <button disabled={busy === row.id || row.status === 'approved' || row.status === 'rejected'} onClick={() => { setNoteFor(row.id); setNote(''); }} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 rounded-lg">
        <X className="w-3.5 h-3.5" />رد
      </button>
    </div>
  );

  return (
    <div className="space-y-4 fade-in" dir="rtl">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center"><Wallet className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-black text-slate-800">پرداخت‌های آنلاین</h2>
            <p className="text-xs text-slate-500">بررسی اقساط زرین‌پال و رسیدهای ارسالی کارآموزان</p>
          </div>
        </div>
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
        <div className="flex items-center gap-2 text-xs font-black text-slate-700"><Link2 className="w-4 h-4 text-sky-500" />ساخت لینک پرداخت برای کارآموز</div>
        <div className="flex flex-wrap items-center gap-2">
          <input inputMode="numeric" value={linkId} onChange={(e) => setLinkId(e.target.value.replace(/[^\d۰-۹]/g, ''))} placeholder="شناسه کارآموز" className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white w-40 font-mono" />
          <button disabled={linkBusy} onClick={makeLink} className="px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 rounded-xl">{linkBusy ? 'در حال ساخت...' : 'ساخت لینک'}</button>
        </div>
        {link && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
            <div className="text-[11px] text-slate-500">لینک برای «{link.student_name || 'کارآموز'}» (۷ روز اعتبار)</div>
            <div className="flex items-center gap-2">
              <input readOnly value={link.url} dir="ltr" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white font-mono min-w-0" onFocus={(e) => e.target.select()} />
              <button onClick={copyLink} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg shrink-0"><Copy className="w-3.5 h-3.5" />{copied ? 'کپی شد' : 'کپی'}</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.id || 'all'} onClick={() => setStatus(f.id)} className={`px-3 py-1.5 text-[11px] font-bold rounded-full border ${status === f.id ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{f.label}</button>
        ))}
      </div>

      {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

      {rows === null ? <div className="text-xs text-slate-400 py-10 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>
        : rows.length === 0 ? <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-10 text-center">موردی برای نمایش نیست.</div>
        : (
          <>
            <div className="hidden lg:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  {['کارآموز', 'شماره همراه', 'دوره', 'مبلغ', 'روش', 'وضعیت', 'رسید', 'تاریخ', 'عملیات'].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                      <td className="px-3 py-2.5 font-bold text-slate-800">{r.student_name || '—'}</td>
                      <td className="px-3 py-2.5 font-mono" dir="ltr">{r.phone_masked || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{r.course_title || '—'}{r.course_number ? ` · ${fa(r.course_number)}` : ''}</td>
                      <td className="px-3 py-2.5 font-black">{fa(r.amount)}</td>
                      <td className="px-3 py-2.5">{op.ONLINE_METHOD_LABEL[r.method]}{r.installment_id ? <span className="block text-[10px] text-slate-400">قسط #{fa(r.installment_id)}</span> : null}</td>
                      <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status]}`}>{op.ONLINE_STATUS_LABEL[r.status]}</span></td>
                      <td className="px-3 py-2.5">{r.receipt_file ? <a href={protectedFileUrl(r.receipt_file)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-700 font-bold hover:underline"><FileText className="w-3.5 h-3.5" />مشاهده</a> : (r.ref_id ? <span className="font-mono text-[10px] text-slate-500">{r.ref_id}</span> : '—')}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-3 py-2.5"><PendingActions row={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden space-y-3">
              {rows.map((r) => (
                <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-black text-slate-800 text-sm truncate">{r.student_name || '—'}</div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5" dir="ltr">{r.phone_masked || ''}</div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${STATUS_STYLE[r.status]}`}>{op.ONLINE_STATUS_LABEL[r.status]}</span>
                  </div>
                  <div className="text-[11px] text-slate-600">{r.course_title || '—'}{r.course_number ? ` · دوره ${fa(r.course_number)}` : ''}</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-black text-slate-800">{fa(r.amount)} تومان</span>
                    <span className="text-slate-500">{op.ONLINE_METHOD_LABEL[r.method]}{r.installment_id ? ` · قسط #${fa(r.installment_id)}` : ''}</span>
                  </div>
                  {r.receipt_file && <a href={protectedFileUrl(r.receipt_file)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-700 text-[11px] font-bold"><FileText className="w-3.5 h-3.5" />مشاهده رسید</a>}
                  {r.admin_note && <div className="text-[10px] text-slate-500 bg-slate-50 rounded-lg px-2 py-1.5">یادداشت: {r.admin_note}</div>}
                  <div className="pt-1"><PendingActions row={r} /></div>
                </div>
              ))}
            </div>
          </>
        )}

      {noteFor && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setNoteFor(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black">رد پرداخت</h3>
            <label className="block text-xs font-bold text-slate-600 space-y-1">دلیل (اختیاری)
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy === noteFor} onClick={reject} className="py-3 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white text-sm font-bold">{busy === noteFor ? '...' : 'ثبت رد'}</button>
              <button onClick={() => setNoteFor(null)} className="py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">انصراف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
