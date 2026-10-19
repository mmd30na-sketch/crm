import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Plus, Edit3, Users, X, Loader2, RefreshCw } from 'lucide-react';
import { Course } from '../types';
import * as t from '../api/courseTerms';
import ModalPortal from './ModalPortal';
import FilterSheet from './FilterSheet';

const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200';

type Draft = { id?: number; course_id: string; course_number: string; title: string; start_date: string; end_date: string; capacity: string; status: t.TermStatus; notes: string };

export default function CourseTermsPanel({ courses, isAdmin }: { courses: Course[]; isAdmin: boolean }) {
  const [rows, setRows] = useState<t.CourseTerm[] | null>(null);
  const [courseFilter, setCourseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | t.TermStatus>('all');
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<t.CourseTerm | null>(null);
  const [students, setStudents] = useState<t.TermStudent[] | null>(null);

  const load = () => { setErr(null); t.listTerms({ course_id: courseFilter, status: statusFilter }).then(setRows).catch((e) => { setErr(e.message); setRows([]); }); };
  useEffect(load, [courseFilter, statusFilter]);
  useEffect(() => {
    if (!viewing) return;
    setStudents(null);
    t.termStudents(viewing.id).then(setStudents).catch((e) => { setErr(e.message); setStudents([]); });
  }, [viewing]);

  const totals = useMemo(() => (rows || []).reduce((a, r) => ({ enrolled: a.enrolled + r.enrolled, due: a.due + r.total_due, paid: a.paid + r.total_paid, rem: a.rem + r.remaining }), { enrolled: 0, due: 0, paid: 0, rem: 0 }), [rows]);

  const openEdit = (r?: t.CourseTerm) => setDraft(r
    ? { id: r.id, course_id: String(r.course_id), course_number: String(r.course_number), title: r.title || '', start_date: r.start_date || '', end_date: r.end_date || '', capacity: r.capacity ? String(r.capacity) : '', status: r.status, notes: r.notes || '' }
    : { course_id: courseFilter !== 'all' ? courseFilter : String(courses[0]?.id || ''), course_number: '', title: '', start_date: '', end_date: '', capacity: '', status: 'active', notes: '' });

  const save = async () => {
    if (!draft) return;
    setSaving(true); setErr(null);
    try {
      const body: t.TermInput = { title: draft.title, start_date: draft.start_date, end_date: draft.end_date, capacity: draft.capacity, status: draft.status, notes: draft.notes };
      if (draft.id) await t.updateTerm(draft.id, body);
      else await t.createTerm({ ...body, course_id: Number(draft.course_id), course_number: Number(draft.course_number) });
      setDraft(null); load();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  const StatusBadge = ({ s }: { s: t.TermStatus }) => (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${s === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{t.TERM_STATUS_LABEL[s]}</span>
  );

  return (
    <div className="space-y-4 fade-in" dir="rtl">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center"><CalendarRange className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-black text-slate-800">مدیریت دوره‌ها</h2>
            <p className="text-xs text-slate-500">دوره‌های برگزارشده بر اساس شماره دوره، ظرفیت و وضعیت</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSheet title="فیلتر دوره‌ها" count={(courseFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)} onClear={() => { setCourseFilter('all'); setStatusFilter('all'); }}>
            <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white" aria-label="دوره">
              <option value="all">همه دوره‌ها</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white" aria-label="وضعیت">
              <option value="all">همه وضعیت‌ها</option>
              <option value="active">در حال برگزاری</option>
              <option value="finished">پایان‌یافته</option>
            </select>
          </FilterSheet>
          <button onClick={load} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی"><RefreshCw className="w-4 h-4" /></button>
          {isAdmin && <button onClick={() => openEdit()} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl"><Plus className="w-4 h-4" />دوره جدید</button>}
        </div>
      </div>

      {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['کارآموزان', fa(totals.enrolled) + ' نفر'], ['کل شهریه', fa(totals.due)], ['پرداخت‌شده', fa(totals.paid)], ['مانده', fa(totals.rem)]].map(([l, v]) => (
          <div key={l} className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm"><div className="text-[11px] text-slate-500">{l}</div><div className="text-sm font-black text-slate-800 mt-1">{v}</div></div>
        ))}
      </div>

      {rows === null ? <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>
        : rows.length === 0 ? <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-8 text-center">دوره‌ای پیدا نشد.</div>
        : (
          <>
            {/* Desktop: table */}
            <div className="hidden lg:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  {['دوره', 'شماره', 'عنوان', 'شروع', 'پایان', 'ظرفیت', 'ثبت‌نام', 'شهریه', 'پرداختی', 'مانده', 'وضعیت', ''].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                      <td className="px-3 py-2.5 font-bold text-slate-800">{r.course_title}</td>
                      <td className="px-3 py-2.5">{fa(r.course_number)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{r.title || '—'}</td>
                      <td className="px-3 py-2.5 font-mono">{r.start_date || '—'}</td>
                      <td className="px-3 py-2.5 font-mono">{r.end_date || '—'}</td>
                      <td className="px-3 py-2.5">{r.capacity ? fa(r.capacity) : '—'}</td>
                      <td className="px-3 py-2.5"><button onClick={() => setViewing(r)} className="text-sky-700 font-bold hover:underline">{fa(r.enrolled)} نفر</button></td>
                      <td className="px-3 py-2.5">{fa(r.total_due)}</td>
                      <td className="px-3 py-2.5 text-emerald-700">{fa(r.total_paid)}</td>
                      <td className={`px-3 py-2.5 ${r.remaining > 0 ? 'text-rose-600 font-bold' : ''}`}>{fa(r.remaining)}</td>
                      <td className="px-3 py-2.5"><StatusBadge s={r.status} /></td>
                      <td className="px-3 py-2.5">{isAdmin && <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="ویرایش"><Edit3 className="w-4 h-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile: cards */}
            <div className="lg:hidden space-y-3">
              {rows.map((r) => (
                <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-black text-slate-800 text-sm truncate">{r.course_title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">دوره شماره {fa(r.course_number)}{r.title ? ` · ${r.title}` : ''}</div>
                    </div>
                    <StatusBadge s={r.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mt-3">
                    <div className="bg-slate-50 rounded-xl py-2"><div className="text-[10px] text-slate-400">شهریه</div><div className="text-xs font-black">{fa(r.total_due)}</div></div>
                    <div className="bg-emerald-50 rounded-xl py-2"><div className="text-[10px] text-emerald-600">پرداختی</div><div className="text-xs font-black text-emerald-700">{fa(r.total_paid)}</div></div>
                    <div className={`${r.remaining > 0 ? 'bg-rose-50' : 'bg-slate-50'} rounded-xl py-2`}><div className="text-[10px] text-slate-400">مانده</div><div className={`text-xs font-black ${r.remaining > 0 ? 'text-rose-700' : ''}`}>{fa(r.remaining)}</div></div>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    {r.start_date || r.end_date ? <>از <span className="font-mono">{r.start_date || '—'}</span> تا <span className="font-mono">{r.end_date || '—'}</span> · </> : null}
                    ظرفیت: {r.capacity ? fa(r.capacity) : '—'}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setViewing(r)} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 rounded-xl"><Users className="w-4 h-4" />{fa(r.enrolled)} کارآموز</button>
                    {isAdmin && <button onClick={() => openEdit(r)} className="flex items-center justify-center gap-1 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 rounded-xl"><Edit3 className="w-4 h-4" />ویرایش</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

      {draft && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setDraft(null)}>
            <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between"><h3 className="text-sm font-black">{draft.id ? 'ویرایش دوره' : 'دوره جدید'}</h3><button onClick={() => setDraft(null)} aria-label="بستن" className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 sm:col-span-1 text-xs font-bold text-slate-600 space-y-1">دوره
                  <select disabled={!!draft.id} value={draft.course_id} onChange={(e) => setDraft({ ...draft, course_id: e.target.value })} className={inputCls}>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select></label>
                <label className="col-span-2 sm:col-span-1 text-xs font-bold text-slate-600 space-y-1">شماره دوره
                  <input disabled={!!draft.id} inputMode="numeric" value={draft.course_number} onChange={(e) => setDraft({ ...draft, course_number: e.target.value.replace(/\D/g, '') })} className={inputCls} /></label>
                <label className="col-span-2 text-xs font-bold text-slate-600 space-y-1">عنوان (اختیاری)
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputCls} /></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">تاریخ شروع
                  <input dir="ltr" placeholder="1405/07/01" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} className={inputCls + ' font-mono text-center'} /></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">تاریخ پایان
                  <input dir="ltr" placeholder="1405/09/30" value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} className={inputCls + ' font-mono text-center'} /></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">ظرفیت
                  <input inputMode="numeric" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value.replace(/\D/g, '') })} className={inputCls} /></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">وضعیت
                  <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as t.TermStatus })} className={inputCls}>
                    <option value="active">در حال برگزاری</option><option value="finished">پایان‌یافته</option>
                  </select></label>
                <label className="col-span-2 text-xs font-bold text-slate-600 space-y-1">یادداشت
                  <textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={inputCls} /></label>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button disabled={saving || (!draft.id && (!draft.course_id || !draft.course_number))} onClick={save} className="py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-sm font-bold">{saving ? 'در حال ذخیره...' : 'ذخیره'}</button>
                <button onClick={() => setDraft(null)} className="py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">انصراف</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {viewing && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setViewing(null)}>
            <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 max-h-[90dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-black truncate">کارآموزان {viewing.course_title} — دوره {fa(viewing.course_number)}</h3>
                <button onClick={() => setViewing(null)} aria-label="بستن" className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
              </div>
              <div className="overflow-y-auto -mx-1 px-1">
                {students === null ? <div className="text-xs text-slate-400 py-6 text-center">در حال بارگذاری...</div>
                  : students.length === 0 ? <div className="text-xs text-slate-400 py-6 text-center">کارآموزی ثبت نشده است.</div>
                  : (
                    <ul className="divide-y divide-slate-100">
                      {students.map((s) => {
                        const rem = Math.max(0, s.final_price - s.paid);
                        return (
                          <li key={s.enrollment_id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="font-bold text-slate-800 truncate">{[s.first_name, s.last_name].filter(Boolean).join(' ') || '—'}</div>
                              <div className="text-slate-400 font-mono mt-0.5" dir="ltr">{s.phone_number || ''}{s.signup_date_jalali ? ` · ${s.signup_date_jalali}` : ''}</div>
                            </div>
                            <div className="text-left shrink-0">
                              <div className="text-slate-600">{fa(s.paid)} / {fa(s.final_price)}</div>
                              {rem > 0 && <div className="text-rose-600 font-bold">مانده {fa(rem)}</div>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
