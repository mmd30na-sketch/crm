import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, RefreshCw, Loader2, Link2, Copy, X, Plus, Split } from 'lucide-react';
import * as inst from '../api/installments';
import { owedByEnrollment } from '../utils/finance';
import type { Student, Course, Enrollment, Payment } from '../types';
import InstallmentRemindersPanel from './InstallmentRemindersPanel';

const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-200';

const STATUS_STYLE: Record<inst.InstallmentStatus, string> = {
  unpaid: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

type Props = {
  students: Student[];
  courses: Course[];
  enrollments: Enrollment[];
  payments: Payment[];
  isAdmin: boolean;
};

/** Installment schedule per enrollment: list, single/split create, cancel and short payment links. */
export default function InstallmentsPanel({ students, courses, enrollments, payments, isAdmin }: Props) {
  const [rows, setRows] = useState<inst.InstallmentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterEnrollment, setFilterEnrollment] = useState('');
  const [filterStatus, setFilterStatus] = useState<inst.InstallmentStatus | ''>('');

  const [formEnrollment, setFormEnrollment] = useState('');
  const [mode, setMode] = useState<'single' | 'split'>('split');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [count, setCount] = useState('3');
  const [startDate, setStartDate] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState<{ url: string; amount: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const studentName = useCallback((id: number) => {
    const s = students.find((x) => x.id === id);
    return s ? [s.first_name, s.last_name].filter(Boolean).join(' ') : `کارآموز #${fa(id)}`;
  }, [students]);

  const courseTitle = useCallback((e: Enrollment) => {
    const c = courses.find((x) => x.id === e.course_id);
    return `${c?.title || `دوره #${e.course_id}`}${e.course_number ? ` #${fa(e.course_number)}` : ''}`;
  }, [courses]);

  const remainingByEnrollment = useMemo(() => owedByEnrollment(
    enrollments.map((e) => ({ id: e.id, final_price: Number(e.final_price) || 0 })),
    payments.map((p) => ({ enrollment_id: p.enrollment_id ?? null, amount: Number(p.amount) || 0 })),
  ), [enrollments, payments]);

  const load = useCallback(() => {
    setErr(null);
    const q: inst.InstallmentQuery = {};
    if (filterEnrollment) q.enrollment_id = Number(filterEnrollment);
    if (filterStatus) q.status = filterStatus;
    inst.listInstallments(q).then(setRows).catch((e) => { setErr(e.message); setRows([]); });
  }, [filterEnrollment, filterStatus]);
  useEffect(load, [load]);

  const sortedEnrollments = useMemo(
    () => [...enrollments].sort((a, b) => b.id - a.id),
    [enrollments],
  );

  const submit = async () => {
    const enrollmentId = Number(formEnrollment);
    if (!enrollmentId) { setErr('ثبت‌نام را انتخاب کنید.'); return; }
    setBusy(true); setErr(null); setNotice(null); setLink(null);
    try {
      if (mode === 'single') {
        const amt = Math.round(Number(amount));
        if (!Number.isFinite(amt) || amt <= 0) throw new Error('مبلغ قسط را درست وارد کنید.');
        if (!dueDate.trim()) throw new Error('تاریخ سررسید را وارد کنید.');
        await inst.createInstallment({ enrollment_id: enrollmentId, amount: amt, due_date_jalali: dueDate.trim(), notes: notes.trim() || undefined });
        setNotice('قسط ثبت شد.');
      } else {
        const c = Math.round(Number(count));
        if (!Number.isFinite(c) || c < 1) throw new Error('تعداد اقساط را درست وارد کنید.');
        if (!startDate.trim()) throw new Error('تاریخ شروع را وارد کنید.');
        const r = await inst.splitInstallments({ enrollment_id: enrollmentId, count: c, start_date_jalali: startDate.trim(), notes: notes.trim() || undefined });
        setNotice(`${fa(r.count)} قسط به مجموع ${fa(r.total)} تومان ثبت شد.`);
      }
      setAmount(''); setDueDate(''); setNotes('');
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const cancel = async (row: inst.InstallmentRow) => {
    setBusy(true); setErr(null); setNotice(null);
    try { await inst.cancelInstallment(row.id); setNotice('قسط لغو شد.'); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const makeLink = async (row: inst.InstallmentRow) => {
    setBusy(true); setErr(null); setNotice(null); setLink(null); setCopied(false);
    try { const r = await inst.createInstallmentLink(row.id); setLink({ url: r.url, amount: r.amount }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };

  const selectedRemaining = formEnrollment ? remainingByEnrollment.get(Number(formEnrollment)) : undefined;

  return (
    <div className="space-y-4 fade-in" dir="rtl">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><CalendarClock className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-black text-slate-800">اقساط</h2>
            <p className="text-xs text-slate-500">زمان‌بندی اقساط هر ثبت‌نام و ساخت لینک پرداخت</p>
          </div>
        </div>
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-black text-slate-700"><Plus className="w-4 h-4 text-emerald-500" />ثبت قسط جدید</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-[11px] font-bold text-slate-600 space-y-1 sm:col-span-2 lg:col-span-2">ثبت‌نام
            <select value={formEnrollment} onChange={(e) => { setFormEnrollment(e.target.value); setLink(null); }} className={inputCls}>
              <option value="">— انتخاب ثبت‌نام —</option>
              {sortedEnrollments.map((e) => (
                <option key={e.id} value={e.id}>{studentName(e.student_id)} — {courseTitle(e)} — مانده {fa(remainingByEnrollment.get(e.id) || 0)}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600 space-y-1">روش
            <select value={mode} onChange={(e) => setMode(e.target.value as 'single' | 'split')} className={inputCls}>
              <option value="split">تقسیم مانده به اقساط ماهانه</option>
              <option value="single">یک قسط</option>
            </select>
          </label>
          {selectedRemaining !== undefined && (
            <div className="text-[11px] font-bold text-slate-600 space-y-1">
              <span>مانده فعلی</span>
              <div className="border border-slate-100 bg-slate-50 rounded-xl px-3 py-2 text-slate-700">{fa(selectedRemaining)} تومان</div>
            </div>
          )}
          {mode === 'single' ? (
            <>
              <label className="text-[11px] font-bold text-slate-600 space-y-1">مبلغ (تومان)
                <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d۰-۹]/g, ''))} className={inputCls + ' font-mono'} />
              </label>
              <label className="text-[11px] font-bold text-slate-600 space-y-1">تاریخ سررسید
                <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls + ' font-mono'} dir="ltr" placeholder="1405/07/01" />
              </label>
            </>
          ) : (
            <>
              <label className="text-[11px] font-bold text-slate-600 space-y-1">تعداد اقساط
                <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d۰-۹]/g, ''))} className={inputCls + ' font-mono'} />
              </label>
              <label className="text-[11px] font-bold text-slate-600 space-y-1">تاریخ شروع
                <input value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls + ' font-mono'} dir="ltr" placeholder="1405/07/01" />
              </label>
            </>
          )}
          <label className="text-[11px] font-bold text-slate-600 space-y-1 sm:col-span-2 lg:col-span-2">یادداشت (اختیاری)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </label>
          <div className="sm:col-span-2 lg:col-span-2 flex items-end">
            <button disabled={busy || !formEnrollment} onClick={submit} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-xs font-bold">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'split' ? <Split className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {mode === 'split' ? 'تقسیم مانده' : 'ثبت قسط'}
            </button>
          </div>
        </div>
      </div>

      {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}
      {notice && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}
      {link && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
          <div className="text-[11px] text-slate-500">لینک پرداخت (مبلغ {fa(link.amount)} تومان) — همان لینکی که در پیامک یادآوری هم استفاده می‌شود.</div>
          <div className="flex items-center gap-2">
            <input readOnly value={link.url} dir="ltr" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white font-mono min-w-0" onFocus={(e) => e.target.select()} />
            <button onClick={copy} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg shrink-0"><Copy className="w-3.5 h-3.5" />{copied ? 'کپی شد' : 'کپی'}</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterEnrollment} onChange={(e) => setFilterEnrollment(e.target.value)} className={inputCls + ' max-w-xs'}>
          <option value="">همه ثبت‌نام‌ها</option>
          {sortedEnrollments.map((e) => <option key={e.id} value={e.id}>{studentName(e.student_id)} — {courseTitle(e)}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as inst.InstallmentStatus | '')} className={inputCls + ' max-w-[10rem]'}>
          <option value="">همه وضعیت‌ها</option>
          <option value="unpaid">پرداخت‌نشده</option>
          <option value="paid">پرداخت‌شده</option>
          <option value="cancelled">لغوشده</option>
        </select>
      </div>

      {rows === null ? <div className="text-xs text-slate-400 py-10 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>
        : rows.length === 0 ? <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-10 text-center">قسطی ثبت نشده است.</div>
        : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-500"><tr>
                {['#', 'کارآموز', 'دوره', 'مبلغ', 'سررسید', 'وضعیت', 'یادداشت', 'عملیات'].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-emerald-50/30">
                    <td className="px-3 py-2.5 font-mono">{fa(r.seq)}</td>
                    <td className="px-3 py-2.5 font-bold text-slate-800">{r.student_name || studentName(r.student_id)}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.course_title || '—'}{r.course_number ? ` #${fa(r.course_number)}` : ''}</td>
                    <td className="px-3 py-2.5 font-black">{fa(r.amount)}</td>
                    <td className="px-3 py-2.5 font-mono">{r.due_date_jalali}</td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status]}`}>{inst.INSTALLMENT_STATUS_LABEL[r.status]}</span></td>
                    <td className="px-3 py-2.5 text-slate-500 max-w-[14rem] truncate">{r.notes || '—'}</td>
                    <td className="px-3 py-2.5">
                      {r.status === 'unpaid' && (
                        <div className="flex items-center gap-1.5">
                          <button disabled={busy} onClick={() => makeLink(r)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg"><Link2 className="w-3 h-3" />لینک</button>
                          <button disabled={busy} onClick={() => cancel(r)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 rounded-lg"><X className="w-3 h-3" />لغو</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {isAdmin && <InstallmentRemindersPanel />}
    </div>
  );
}
