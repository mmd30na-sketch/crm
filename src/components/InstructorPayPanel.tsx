import React, { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Coins, CalendarDays, Wallet, Plus, Edit3, Trash2, X, Loader2, RefreshCw, ChevronRight, ChevronLeft, Printer, Download, Undo2 } from 'lucide-react';
import * as t from '../api/instructorPay';
import { listTerms } from '../api/courseTerms';
import { CourseTerm } from '../api/courseTerms';
import { jalaliTodayParts } from '../utils/normalize';
import { JALALI_MONTH_NAMES } from '../utils/charts';
import { downloadCsv } from '../utils/exportCsv';
import ModalPortal from './ModalPortal';

const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const toman = (n: number) => fa(n) + ' تومان';
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200';

type Tab = 'instructors' | 'rates' | 'sessions' | 'report';
const TABS: { id: Tab; label: string; icon: typeof GraduationCap }[] = [
  { id: 'instructors', label: 'مربیان', icon: GraduationCap },
  { id: 'rates', label: 'نرخ‌ها', icon: Coins },
  { id: 'sessions', label: 'جلسات', icon: CalendarDays },
  { id: 'report', label: 'گزارش ماهانه', icon: Wallet },
];

const currentMonth = () => { const { jy, jm } = jalaliTodayParts(); return `${jy}/${String(jm).padStart(2, '0')}`; };
const addMonth = (ym: string, delta: number) => {
  let y = Number(ym.slice(0, 4)); let m = Number(ym.slice(5, 7)) + delta;
  while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
  return `${y}/${String(m).padStart(2, '0')}`;
};
const monthLabel = (ym: string) => `${JALALI_MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${fa(Number(ym.slice(0, 4)))}`;

type InstructorDraft = { id?: number; name: string; phone: string; active: boolean; notes: string };
type RateDraft = { id?: number; instructor_id: string; course_term_id: string; rate_type: t.RateType; amount: string };
type SessionDraft = { id?: number; instructor_id: string; course_term_id: string; session_date: string; hours: string; notes: string };

const termOptionsLabel = (c: CourseTerm) => `${c.course_title || ''} — دوره ${fa(c.course_number)}`;

export default function InstructorPayPanel() {
  const [tab, setTab] = useState<Tab>('instructors');
  const [instructors, setInstructors] = useState<t.Instructor[] | null>(null);
  const [terms, setTerms] = useState<CourseTerm[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [instDraft, setInstDraft] = useState<InstructorDraft | null>(null);
  const [rateDraft, setRateDraft] = useState<RateDraft | null>(null);
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null);
  const [rates, setRates] = useState<t.Rate[] | null>(null);
  const [sessions, setSessions] = useState<t.SessionRow[] | null>(null);
  const [sessionInstructor, setSessionInstructor] = useState('all');
  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState<t.Report | null>(null);

  const loadInstructors = () => { setErr(null); t.listInstructors().then(setInstructors).catch((e) => { setErr(e.message); setInstructors([]); }); };
  useEffect(loadInstructors, []);
  useEffect(() => { listTerms().then(setTerms).catch(() => setTerms([])); }, []);
  useEffect(() => { if (tab === 'rates') { setErr(null); t.listRates().then(setRates).catch((e) => { setErr(e.message); setRates([]); }); } }, [tab]);
  useEffect(() => { if (tab === 'sessions') { setErr(null); t.listSessions({ instructor_id: sessionInstructor }).then(setSessions).catch((e) => { setErr(e.message); setSessions([]); }); } }, [tab, sessionInstructor]);
  useEffect(() => { if (tab === 'report') { setErr(null); setReport(null); t.fetchReport(month).then(setReport).catch((e) => { setErr(e.message); setReport({ month, rows: [] }); }); } }, [tab, month]);

  const activeInstructors = useMemo(() => (instructors || []).filter((i) => i.active), [instructors]);

  const saveInstructor = async () => {
    if (!instDraft) return;
    setSaving(true); setErr(null);
    try {
      const body: t.InstructorInput = { name: instDraft.name, phone: instDraft.phone, active: instDraft.active, notes: instDraft.notes };
      if (instDraft.id) await t.updateInstructor(instDraft.id, body);
      else await t.createInstructor(body);
      setInstDraft(null); loadInstructors();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };
  const openInstructor = async (r?: t.Instructor) => {
    if (!r) { setInstDraft({ name: '', phone: '', active: true, notes: '' }); return; }
    try { const full = await t.getInstructor(r.id); setInstDraft({ id: full.id, name: full.name, phone: full.phone || '', active: full.active, notes: full.notes || '' }); }
    catch (e: any) { setErr(e.message); }
  };
  const removeInstructor = async (r: t.Instructor) => {
    if (!window.confirm(`مربی «${r.name}» و همه نرخ‌ها، جلسات و تسویه‌های او حذف شود؟`)) return;
    setErr(null);
    try { await t.deleteInstructor(r.id); loadInstructors(); } catch (e: any) { setErr(e.message); }
  };

  const saveRate = async () => {
    if (!rateDraft) return;
    setSaving(true); setErr(null);
    try {
      const body: t.RateInput = {
        instructor_id: Number(rateDraft.instructor_id), course_term_id: rateDraft.course_term_id ? Number(rateDraft.course_term_id) : null,
        rate_type: rateDraft.rate_type, amount: Math.round(Number(rateDraft.amount)),
      };
      if (rateDraft.id) await t.updateRate(rateDraft.id, body);
      else await t.createRate(body);
      setRateDraft(null); t.listRates().then(setRates).catch(() => {});
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };
  const saveSession = async () => {
    if (!sessionDraft) return;
    setSaving(true); setErr(null);
    try {
      const body: t.SessionInput = {
        instructor_id: Number(sessionDraft.instructor_id), course_term_id: sessionDraft.course_term_id ? Number(sessionDraft.course_term_id) : null,
        session_date: sessionDraft.session_date, hours: Number(sessionDraft.hours) || 1, notes: sessionDraft.notes,
      };
      if (sessionDraft.id) await t.updateSession(sessionDraft.id, body);
      else await t.createSession(body);
      setSessionDraft(null); t.listSessions({ instructor_id: sessionInstructor }).then(setSessions).catch(() => {});
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };
  const settle = async (r: t.ReportRow) => {
    setErr(null);
    try { await t.markSettled({ instructor_id: r.instructor_id, year_month: report!.month }); t.fetchReport(month).then(setReport).catch(() => {}); }
    catch (e: any) { setErr(e.message); }
  };
  const undoSettle = async (r: t.ReportRow) => {
    if (!r.settled_id) return;
    setErr(null);
    try { await t.undoSettlement(r.settled_id); t.fetchReport(month).then(setReport).catch(() => {}); }
    catch (e: any) { setErr(e.message); }
  };

  const exportReportCsv = () => {
    if (!report) return;
    downloadCsv<t.ReportRow>(` حق‌التدریس-${report.month}`.trim(), report.rows, [
      { header: 'مربی', value: (r) => r.name },
      { header: 'موبایل', value: (r) => r.phone || '' },
      { header: 'تعداد جلسات', value: (r) => fa(r.sessions_count) },
      { header: 'مجموع ساعت', value: (r) => fa(r.sessions_hours) },
      { header: 'جمع جلسات (تومان)', value: (r) => fa(r.per_session_total) },
      { header: 'دوره‌های مشمول', value: (r) => r.per_term_items.map((i) => i.term_label || '').filter(Boolean).join('، ') },
      { header: 'جمع دوره‌ها (تومان)', value: (r) => fa(r.per_term_total) },
      { header: 'جمع کل (تومان)', value: (r) => fa(r.total) },
      { header: 'تسویه', value: (r) => (r.settled ? 'تسویه‌شده' : 'پرداخت‌نشده') },
    ]);
  };
  const printReport = () => {
    if (!report) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { setErr('پنجره چاپ باز نشد؛ اجازه باز شدن pop-up را بدهید.'); return; }
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = report.rows.map((r) => `<tr>
      <td>${esc(r.name)}</td><td>${esc(r.phone || '')}</td><td>${fa(r.sessions_count)}</td><td>${fa(r.sessions_hours)}</td>
      <td>${fa(r.per_session_total)}</td><td>${esc(r.per_term_items.map((i) => i.term_label || '').filter(Boolean).join('، '))}</td>
      <td>${fa(r.per_term_total)}</td><td><b>${fa(r.total)}</b></td><td>${r.settled ? 'تسویه‌شده' : 'پرداخت‌نشده'}</td></tr>`).join('');
    w.document.write(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>حق‌التدریس ${esc(monthLabel(report.month))}</title>
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;padding:24px;color:#0f172a}h2{margin:0 0 4px}p{margin:0 0 16px;color:#475569;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:right}th{background:#f1f5f9}</style></head>
<body><h2>حق‌التدریس — ${esc(monthLabel(report.month))}</h2><p>گزارش ماهانه مربیان</p>
<table><thead><tr><th>مربی</th><th>موبایل</th><th>جلسات</th><th>ساعت</th><th>جمع جلسات</th><th>دوره‌های مشمول</th><th>جمع دوره‌ها</th><th>جمع کل</th><th>تسویه</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const empty = (label: string) => <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-8 text-center">{label}</div>;
  const loadingBox = <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>;

  return (
    <div className="space-y-4 fade-in" dir="rtl">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><Wallet className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-black text-slate-800">حق‌التدریس</h2>
            <p className="text-xs text-slate-500">مربیان، نرخ‌ها، جلسات و تسویه ماهانه</p>
          </div>
        </div>
        <button onClick={() => { loadInstructors(); if (tab === 'rates') t.listRates().then(setRates).catch(() => {}); if (tab === 'sessions') t.listSessions({ instructor_id: sessionInstructor }).then(setSessions).catch(() => {}); if (tab === 'report') t.fetchReport(month).then(setReport).catch(() => {}); }} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${tab === id ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* ── مربیان ── */}
      {tab === 'instructors' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => setInstDraft({ name: '', phone: '', active: true, notes: '' })} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl"><Plus className="w-4 h-4" />مربی جدید</button>
          </div>
          {instructors === null ? loadingBox : instructors.length === 0 ? empty('مربی‌ای ثبت نشده است.')
            : (
              <>
                <div className="hidden lg:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-50 text-slate-500"><tr>{['نام', 'موبایل', 'وضعیت', 'یادداشت', ''].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
                    <tbody>
                      {instructors.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                          <td className="px-3 py-2.5 font-bold text-slate-800">{r.name}</td>
                          <td className="px-3 py-2.5 font-mono" dir="ltr">{r.phone || '—'}</td>
                          <td className="px-3 py-2.5"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${r.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{r.active ? 'فعال' : 'غیرفعال'}</span></td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[240px] truncate">{r.notes || '—'}</td>
                          <td className="px-3 py-2.5"><div className="flex items-center gap-1">
                            <button onClick={() => openInstructor(r)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="ویرایش"><Edit3 className="w-4 h-4" /></button>
                            <button onClick={() => removeInstructor(r)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="lg:hidden space-y-3">
                  {instructors.map((r) => (
                    <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-black text-slate-800 text-sm truncate">{r.name}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5" dir="ltr">{r.phone || '—'}</div>
                        </div>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${r.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{r.active ? 'فعال' : 'غیرفعال'}</span>
                      </div>
                      {r.notes && <div className="text-[11px] text-slate-500 mt-2">{r.notes}</div>}
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => openInstructor(r)} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 rounded-xl"><Edit3 className="w-4 h-4" />ویرایش</button>
                        <button onClick={() => removeInstructor(r)} className="flex items-center justify-center px-4 py-2.5 text-xs font-bold text-rose-600 bg-rose-50 rounded-xl"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
        </>
      )}

      {/* ── نرخ‌ها ── */}
      {tab === 'rates' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => setRateDraft({ instructor_id: String(activeInstructors[0]?.id || ''), course_term_id: '', rate_type: 'per_session', amount: '' })} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl"><Plus className="w-4 h-4" />نرخ جدید</button>
          </div>
          {rates === null ? loadingBox : rates.length === 0 ? empty('نرخی ثبت نشده است.')
            : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 text-slate-500"><tr>{['مربی', 'نوع نرخ', 'دوره', 'مبلغ', ''].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
                  <tbody>
                    {rates.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                        <td className="px-3 py-2.5 font-bold text-slate-800">{r.instructor_name || '—'}</td>
                        <td className="px-3 py-2.5">{t.RATE_TYPE_LABEL[r.rate_type]}</td>
                        <td className="px-3 py-2.5 text-slate-600">{r.term_label || (r.rate_type === 'per_session' ? 'همه دوره‌ها' : '—')}</td>
                        <td className="px-3 py-2.5 font-bold">{toman(r.amount)}</td>
                        <td className="px-3 py-2.5"><div className="flex items-center gap-1">
                          <button onClick={() => setRateDraft({ id: r.id, instructor_id: String(r.instructor_id), course_term_id: r.course_term_id ? String(r.course_term_id) : '', rate_type: r.rate_type, amount: String(r.amount) })} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="ویرایش"><Edit3 className="w-4 h-4" /></button>
                          <button onClick={async () => { if (window.confirm('این نرخ حذف شود؟')) { try { await t.deleteRate(r.id); t.listRates().then(setRates).catch(() => {}); } catch (e: any) { setErr(e.message); } } }} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}

      {/* ── جلسات ── */}
      {tab === 'sessions' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select value={sessionInstructor} onChange={(e) => setSessionInstructor(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white" aria-label="فیلتر مربی">
              <option value="all">همه مربیان</option>
              {(instructors || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <button onClick={() => setSessionDraft({ instructor_id: String(activeInstructors[0]?.id || ''), course_term_id: '', session_date: '', hours: '1', notes: '' })} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl"><Plus className="w-4 h-4" />جلسه جدید</button>
          </div>
          {sessions === null ? loadingBox : sessions.length === 0 ? empty('جلسه‌ای ثبت نشده است.')
            : (
              <>
                <div className="hidden lg:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-50 text-slate-500"><tr>{['مربی', 'تاریخ', 'دوره', 'مدت (ساعت)', 'یادداشت', ''].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
                    <tbody>
                      {sessions.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                          <td className="px-3 py-2.5 font-bold text-slate-800">{r.instructor_name || '—'}</td>
                          <td className="px-3 py-2.5 font-mono">{r.session_date}</td>
                          <td className="px-3 py-2.5 text-slate-600">{r.term_label || '—'}</td>
                          <td className="px-3 py-2.5">{fa(r.hours)}</td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[220px] truncate">{r.notes || '—'}</td>
                          <td className="px-3 py-2.5"><div className="flex items-center gap-1">
                            <button onClick={() => setSessionDraft({ id: r.id, instructor_id: String(r.instructor_id), course_term_id: r.course_term_id ? String(r.course_term_id) : '', session_date: r.session_date, hours: String(r.hours), notes: r.notes || '' })} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="ویرایش"><Edit3 className="w-4 h-4" /></button>
                            <button onClick={async () => { if (window.confirm('این جلسه حذف شود؟')) { try { await t.deleteSession(r.id); t.listSessions({ instructor_id: sessionInstructor }).then(setSessions).catch(() => {}); } catch (e: any) { setErr(e.message); } } }} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="lg:hidden space-y-3">
                  {sessions.map((r) => (
                    <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-black text-slate-800 text-sm truncate">{r.instructor_name || '—'}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">{r.session_date} · {fa(r.hours)} ساعت</div>
                        </div>
                        <div className="text-[11px] text-slate-500 shrink-0">{r.term_label || '—'}</div>
                      </div>
                      {r.notes && <div className="text-[11px] text-slate-500 mt-2">{r.notes}</div>}
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setSessionDraft({ id: r.id, instructor_id: String(r.instructor_id), course_term_id: r.course_term_id ? String(r.course_term_id) : '', session_date: r.session_date, hours: String(r.hours), notes: r.notes || '' })} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 rounded-xl"><Edit3 className="w-4 h-4" />ویرایش</button>
                        <button onClick={async () => { if (window.confirm('این جلسه حذف شود؟')) { try { await t.deleteSession(r.id); t.listSessions({ instructor_id: sessionInstructor }).then(setSessions).catch(() => {}); } catch (e: any) { setErr(e.message); } } }} className="flex items-center justify-center px-4 py-2.5 text-xs font-bold text-rose-600 bg-rose-50 rounded-xl"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
        </>
      )}

      {/* ── گزارش ماهانه ── */}
      {tab === 'report' && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setMonth(addMonth(month, -1))} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="ماه قبل"><ChevronRight className="w-4 h-4" /></button>
              <div className="text-sm font-black text-slate-800 min-w-[110px] text-center">{monthLabel(month)}</div>
              <button onClick={() => setMonth(addMonth(month, 1))} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="ماه بعد"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setMonth(currentMonth())} className="px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl">ماه جاری</button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={printReport} disabled={!report} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl disabled:opacity-50"><Printer className="w-4 h-4" />چاپ</button>
              <button onClick={exportReportCsv} disabled={!report} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:bg-emerald-300"><Download className="w-4 h-4" />خروجی اکسل</button>
            </div>
          </div>
          {report === null ? loadingBox : report.rows.length === 0 ? empty('برای این ماه داده‌ای وجود ندارد.')
            : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {[['تعداد مربیان', fa(report.rows.length) + ' نفر'], ['جمع کل جلسات', fa(report.rows.reduce((a, r) => a + r.sessions_count, 0)) + ' جلسه'], ['جمع کل پرداختی', toman(report.rows.reduce((a, r) => a + r.total, 0))]].map(([l, v]) => (
                    <div key={l} className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm"><div className="text-[11px] text-slate-500">{l}</div><div className="text-sm font-black text-slate-800 mt-1">{v}</div></div>
                  ))}
                </div>
                <div className="hidden lg:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-50 text-slate-500"><tr>{['مربی', 'موبایل', 'جلسات', 'ساعت', 'جمع جلسات', 'دوره‌های مشمول', 'جمع دوره‌ها', 'جمع کل', 'تسویه', ''].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <tr key={r.instructor_id} className="border-t border-slate-100 hover:bg-sky-50/40">
                          <td className="px-3 py-2.5 font-bold text-slate-800">{r.name}</td>
                          <td className="px-3 py-2.5 font-mono" dir="ltr">{r.phone || '—'}</td>
                          <td className="px-3 py-2.5">{fa(r.sessions_count)}</td>
                          <td className="px-3 py-2.5">{fa(r.sessions_hours)}</td>
                          <td className="px-3 py-2.5">{fa(r.per_session_total)}</td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[220px]">{r.per_term_items.map((i) => i.term_label || '').filter(Boolean).join('، ') || '—'}</td>
                          <td className="px-3 py-2.5">{fa(r.per_term_total)}</td>
                          <td className="px-3 py-2.5 font-black">{toman(r.total)}</td>
                          <td className="px-3 py-2.5">{r.settled
                            ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">تسویه‌شده</span>
                            : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">پرداخت‌نشده</span>}</td>
                          <td className="px-3 py-2.5">{r.settled
                            ? <button onClick={() => undoSettle(r)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="لغو تسویه"><Undo2 className="w-4 h-4" /></button>
                            : r.total > 0 && <button onClick={() => settle(r)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700">ثبت تسویه</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="lg:hidden space-y-3">
                  {report.rows.map((r) => (
                    <div key={r.instructor_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-black text-slate-800 text-sm truncate">{r.name}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5" dir="ltr">{r.phone || '—'}</div>
                        </div>
                        {r.settled
                          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 shrink-0">تسویه‌شده</span>
                          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 shrink-0">پرداخت‌نشده</span>}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center mt-3">
                        <div className="bg-slate-50 rounded-xl py-2"><div className="text-[10px] text-slate-400">جلسات</div><div className="text-xs font-black">{fa(r.sessions_count)}</div></div>
                        <div className="bg-sky-50 rounded-xl py-2"><div className="text-[10px] text-sky-600">جمع جلسات</div><div className="text-xs font-black text-sky-700">{fa(r.per_session_total)}</div></div>
                        <div className="bg-amber-50 rounded-xl py-2"><div className="text-[10px] text-amber-600">جمع دوره‌ها</div><div className="text-xs font-black text-amber-700">{fa(r.per_term_total)}</div></div>
                      </div>
                      {r.per_term_items.length > 0 && <div className="text-[11px] text-slate-500 mt-2">دوره‌ها: {r.per_term_items.map((i) => i.term_label || '').filter(Boolean).join('، ')}</div>}
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                        <div className="text-sm font-black text-slate-800">{toman(r.total)}</div>
                        {r.settled
                          ? <button onClick={() => undoSettle(r)} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl"><Undo2 className="w-4 h-4" />لغو تسویه</button>
                          : r.total > 0 && <button onClick={() => settle(r)} className="px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl">ثبت تسویه</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
        </>
      )}

      {instDraft && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setInstDraft(null)}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between"><h3 className="text-sm font-black">{instDraft.id ? 'ویرایش مربی' : 'مربی جدید'}</h3><button onClick={() => setInstDraft(null)} aria-label="بستن" className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-600 space-y-1">نام و نام خانوادگی
                  <input value={instDraft.name} onChange={(e) => setInstDraft({ ...instDraft, name: e.target.value })} className={inputCls} /></label>
                <label className="block text-xs font-bold text-slate-600 space-y-1">موبایل
                  <input dir="ltr" inputMode="tel" placeholder="09xxxxxxxxx" value={instDraft.phone} onChange={(e) => setInstDraft({ ...instDraft, phone: e.target.value.replace(/[^\d+]/g, '') })} className={inputCls + ' font-mono text-center'} /></label>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={instDraft.active} onChange={(e) => setInstDraft({ ...instDraft, active: e.target.checked })} className="rounded" />فعال</label>
                <label className="block text-xs font-bold text-slate-600 space-y-1">یادداشت
                  <textarea rows={3} value={instDraft.notes} onChange={(e) => setInstDraft({ ...instDraft, notes: e.target.value })} className={inputCls} /></label>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button disabled={saving || !instDraft.name.trim()} onClick={saveInstructor} className="py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-sm font-bold">{saving ? 'در حال ذخیره...' : 'ذخیره'}</button>
                <button onClick={() => setInstDraft(null)} className="py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">انصراف</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {rateDraft && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setRateDraft(null)}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between"><h3 className="text-sm font-black">{rateDraft.id ? 'ویرایش نرخ' : 'نرخ جدید'}</h3><button onClick={() => setRateDraft(null)} aria-label="بستن" className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 text-xs font-bold text-slate-600 space-y-1">مربی
                  <select value={rateDraft.instructor_id} onChange={(e) => setRateDraft({ ...rateDraft, instructor_id: e.target.value })} className={inputCls}>
                    {activeInstructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">نوع نرخ
                  <select value={rateDraft.rate_type} onChange={(e) => setRateDraft({ ...rateDraft, rate_type: e.target.value as t.RateType })} className={inputCls}>
                    <option value="per_session">به ازای هر جلسه</option>
                    <option value="per_term">به ازای هر دوره</option>
                  </select></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">مبلغ (تومان)
                  <input inputMode="numeric" value={rateDraft.amount} onChange={(e) => setRateDraft({ ...rateDraft, amount: e.target.value.replace(/\D/g, '') })} className={inputCls} /></label>
                <label className="col-span-2 text-xs font-bold text-slate-600 space-y-1">{rateDraft.rate_type === 'per_term' ? 'دوره' : 'دوره (اختیاری — خالی یعنی همه دوره‌ها)'}
                  <select value={rateDraft.course_term_id} onChange={(e) => setRateDraft({ ...rateDraft, course_term_id: e.target.value })} className={inputCls}>
                    <option value="">{rateDraft.rate_type === 'per_term' ? 'انتخاب دوره...' : 'همه دوره‌ها'}</option>
                    {terms.map((c) => <option key={c.id} value={c.id}>{termOptionsLabel(c)}</option>)}
                  </select></label>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button disabled={saving || !rateDraft.instructor_id || !rateDraft.amount || (rateDraft.rate_type === 'per_term' && !rateDraft.course_term_id)} onClick={saveRate} className="py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-sm font-bold">{saving ? 'در حال ذخیره...' : 'ذخیره'}</button>
                <button onClick={() => setRateDraft(null)} className="py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">انصراف</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {sessionDraft && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setSessionDraft(null)}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between"><h3 className="text-sm font-black">{sessionDraft.id ? 'ویرایش جلسه' : 'جلسه جدید'}</h3><button onClick={() => setSessionDraft(null)} aria-label="بستن" className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 text-xs font-bold text-slate-600 space-y-1">مربی
                  <select value={sessionDraft.instructor_id} onChange={(e) => setSessionDraft({ ...sessionDraft, instructor_id: e.target.value })} className={inputCls}>
                    {activeInstructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">تاریخ جلسه
                  <input dir="ltr" placeholder="1405/07/16" value={sessionDraft.session_date} onChange={(e) => setSessionDraft({ ...sessionDraft, session_date: e.target.value })} className={inputCls + ' font-mono text-center'} /></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">مدت (ساعت)
                  <input inputMode="decimal" value={sessionDraft.hours} onChange={(e) => setSessionDraft({ ...sessionDraft, hours: e.target.value.replace(/[^\d.]/g, '') })} className={inputCls} /></label>
                <label className="col-span-2 text-xs font-bold text-slate-600 space-y-1">دوره (اختیاری)
                  <select value={sessionDraft.course_term_id} onChange={(e) => setSessionDraft({ ...sessionDraft, course_term_id: e.target.value })} className={inputCls}>
                    <option value="">بدون دوره</option>
                    {terms.map((c) => <option key={c.id} value={c.id}>{termOptionsLabel(c)}</option>)}
                  </select></label>
                <label className="col-span-2 text-xs font-bold text-slate-600 space-y-1">یادداشت
                  <textarea rows={2} value={sessionDraft.notes} onChange={(e) => setSessionDraft({ ...sessionDraft, notes: e.target.value })} className={inputCls} /></label>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button disabled={saving || !sessionDraft.instructor_id || !sessionDraft.session_date.trim()} onClick={saveSession} className="py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white text-sm font-bold">{saving ? 'در حال ذخیره...' : 'ذخیره'}</button>
                <button onClick={() => setSessionDraft(null)} className="py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">انصراف</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
