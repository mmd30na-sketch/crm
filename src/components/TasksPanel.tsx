import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, AlertTriangle, CheckCircle2, X, RefreshCw } from 'lucide-react';
import * as p4 from '../api/phase4';
import ModalPortal from './ModalPortal';

type Props = { username: string; isAdmin: boolean; onCountsChange?: () => void };
const fmt = (s: string | null) => { const d = p4.utc(s); return d ? d.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' }) : '—'; };
const toLocalInput = (s: string | null) => { const d = p4.utc(s); if (!d) return ''; const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
const PRIO_CLS: Record<p4.TaskPriority, string> = { low: 'bg-slate-100 text-slate-600', normal: 'bg-sky-50 text-sky-700', high: 'bg-rose-50 text-rose-700' };

type Draft = p4.TaskInput & { id?: number; due_local?: string };

export default function TasksPanel({ username, isAdmin, onCountsChange }: Props) {
  const [tasks, setTasks] = useState<p4.Task[]>([]);
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [showDone, setShowDone] = useState(false);
  const [assignees, setAssignees] = useState<Array<{ username: string; full_name: string }>>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try { setTasks(await p4.listTasks({ mine: view === 'mine' || !isAdmin })); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [view]);
  useEffect(() => { p4.listAssignees().then(setAssignees).catch(() => undefined); }, []);

  const visible = useMemo(() => tasks.filter((t) => showDone || t.status === 'open' || t.status === 'in_progress'), [tasks, showDone]);
  const overdue = tasks.filter((t) => t.overdue).length;
  const nameOf = (u: string | null) => assignees.find((a) => a.username === u)?.full_name || u || 'بدون مسئول';

  const save = async () => {
    if (!draft) return;
    setErr('');
    const body: p4.TaskInput = {
      title: draft.title, description: draft.description, assignee_username: draft.assignee_username, priority: draft.priority,
      status: draft.status, entity_type: draft.entity_type, entity_id: draft.entity_id,
      due_at: draft.due_local ? new Date(draft.due_local).toISOString() : null,
    };
    try {
      if (draft.id) await p4.updateTask(draft.id, body); else await p4.createTask(body);
      setDraft(null); await load(); onCountsChange?.();
    } catch (e: any) { setErr(e.message); }
  };
  const quickStatus = async (t: p4.Task, status: p4.TaskStatus) => {
    try { await p4.updateTask(t.id, { ...t, status, due_at: p4.utc(t.due_at)?.toISOString() ?? null }); await load(); onCountsChange?.(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center"><ClipboardList className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-black text-slate-900">کارها و پیگیری‌ها</h2>
            <p className="text-xs text-slate-400 mt-0.5">ارجاع کار به همکاران با مهلت و اولویت</p>
          </div>
          {overdue > 0 && <span className="flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1"><AlertTriangle className="w-3.5 h-3.5" />{overdue.toLocaleString('fa-IR')} کار عقب‌افتاده</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold border border-slate-200">
              {(['mine', 'all'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg ${view === v ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500'}`}>{v === 'mine' ? 'کارهای من' : 'همه کارها'}</button>
              ))}
            </div>
          )}
          <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />نمایش انجام‌شده‌ها</label>
          <button onClick={load} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button onClick={() => setDraft({ title: '', priority: 'normal', status: 'open', assignee_username: username, due_local: '' })}
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl"><Plus className="w-3.5 h-3.5" />کار جدید</button>
        </div>
      </div>

      {err && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 text-slate-500"><tr>
            <th className="p-3 font-bold">عنوان</th><th className="p-3 font-bold">مسئول</th><th className="p-3 font-bold">مهلت</th>
            <th className="p-3 font-bold">اولویت</th><th className="p-3 font-bold">مرتبط با</th><th className="p-3 font-bold">وضعیت</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">کاری وجود ندارد</td></tr>}
            {visible.map((t) => (
              <tr key={t.id} className={`border-t border-slate-100 ${t.overdue ? 'bg-rose-50/40' : ''}`}>
                <td className="p-3"><button onClick={() => setDraft({ ...t, due_local: toLocalInput(t.due_at) })} className="font-bold text-slate-800 hover:text-indigo-700 text-right">{t.title}</button>
                  {t.description && <p className="text-[11px] text-slate-400 line-clamp-1">{t.description}</p>}</td>
                <td className="p-3">{nameOf(t.assignee_username)}</td>
                <td className={`p-3 whitespace-nowrap ${t.overdue ? 'text-rose-700 font-bold' : ''}`}>{fmt(t.due_at)}{t.overdue && <span className="mr-1 text-[10px] bg-rose-600 text-white rounded px-1">عقب‌افتاده</span>}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded ${PRIO_CLS[t.priority]}`}>{p4.TASK_PRIORITY_LABEL[t.priority]}</span></td>
                <td className="p-3">{t.entity_type ? `${t.entity_type === 'lead' ? 'سرنخ' : 'هنرجو'}: ${t.entity_name || `#${t.entity_id}`}` : '—'}</td>
                <td className="p-3">
                  <select value={t.status} onChange={(e) => quickStatus(t, e.target.value as p4.TaskStatus)} className="border border-slate-200 rounded-lg px-1.5 py-1 bg-white">
                    {Object.entries(p4.TASK_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="p-3">{t.status !== 'done' && <button title="انجام شد" onClick={() => quickStatus(t, 'done')} className="text-emerald-600 hover:text-emerald-800"><CheckCircle2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <ModalPortal><div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-black">{draft.id ? 'ویرایش کار' : 'کار جدید'}</h3><button onClick={() => setDraft(null)}><X className="w-4 h-4" /></button></div>
            <input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="عنوان کار" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            <textarea value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="توضیحات" rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="space-y-1">مسئول
                <select disabled={!isAdmin} value={draft.assignee_username || ''} onChange={(e) => setDraft({ ...draft, assignee_username: e.target.value || null })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  <option value="">بدون مسئول</option>
                  {assignees.map((a) => <option key={a.username} value={a.username}>{a.full_name} ({a.username})</option>)}
                </select></label>
              <label className="space-y-1">مهلت
                <input type="datetime-local" value={draft.due_local || ''} onChange={(e) => setDraft({ ...draft, due_local: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5" dir="ltr" /></label>
              <label className="space-y-1">اولویت
                <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as p4.TaskPriority })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  {Object.entries(p4.TASK_PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label className="space-y-1">وضعیت
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as p4.TaskStatus })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  {Object.entries(p4.TASK_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label className="space-y-1">مرتبط با
                <select value={draft.entity_type || ''} onChange={(e) => setDraft({ ...draft, entity_type: (e.target.value || null) as any })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  <option value="">هیچ‌کدام</option><option value="student">هنرجو</option><option value="lead">سرنخ</option>
                </select></label>
              <label className="space-y-1">شماره پرونده
                <input type="number" disabled={!draft.entity_type} value={draft.entity_id || ''} onChange={(e) => setDraft({ ...draft, entity_id: Number(e.target.value) || null })} className="w-full border border-slate-200 rounded-lg px-2 py-1.5" dir="ltr" /></label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDraft(null)} className="px-4 py-2 text-xs font-bold bg-slate-100 rounded-lg">انصراف</button>
              <button onClick={save} className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg">ذخیره</button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  );
}
