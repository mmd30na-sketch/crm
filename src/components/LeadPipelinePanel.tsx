// Lead pipeline («پایپ‌لاین سرنخ‌ها»): Kanban board with drag-and-drop (plus a stage select for touch devices),
// lead drawer (owner, stage, notes), conversion-rate report with CSS charts, and stage configuration (admin).
import React, { useEffect, useState, useCallback } from 'react';
import {
  getBoard,
  getStages,
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
  moveLead,
  setLeadOwner,
  getLeadNotes,
  addLeadNote,
  getReport,
  listLeadSources,
  listAssignees,
  type Stage,
  type StageColor,
  type PipelineLead,
  type Note,
  type PipelineReport,
} from '../api/leadPipeline';
import { Loader2, Plus, Trash2, RefreshCw, Search, X, ArrowUp, ArrowDown, Save } from 'lucide-react';

const BTN = 'inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50';
const BTN_LIGHT = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const INPUT = 'rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200';
const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const pct = (r: number) => `${((Number(r) || 0) * 100).toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪`;
const LEGACY_STATUS: Record<string, string> = { new: 'جدید', contacted: 'تماس گرفته شد', in_negotiation: 'در حال مذاکره', converted: 'تبدیل‌شده', lost: 'از دست رفته' };
const COLOR_FA: Record<string, string> = { slate: 'خاکستری', sky: 'آبی روشن', amber: 'کهربایی', indigo: 'نیلی', emerald: 'سبز', rose: 'قرمز', violet: 'بنفش', teal: 'فیروزه‌ای', orange: 'نارنجی' };
type Tab = 'board' | 'report' | 'stages';

const colorMap: Record<StageColor, { bg: string; text: string; border: string; dot: string }> = {
  slate: {
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
    dot: 'bg-slate-500',
  },
  sky: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    dot: 'bg-sky-500',
  },
  amber: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  indigo: {
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    dot: 'bg-indigo-500',
  },
  emerald: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  rose: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    dot: 'bg-rose-500',
  },
  violet: {
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    border: 'border-violet-200',
    dot: 'bg-violet-500',
  },
  teal: {
    bg: 'bg-teal-50',
    text: 'text-teal-700',
    border: 'border-teal-200',
    dot: 'bg-teal-500',
  },
  orange: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
  },
};

export default function LeadPipelinePanel({ isAdmin }: { isAdmin: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>('board');
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<number | ''>('');
  const [ownerFilter, setOwnerFilter] = useState<string | ''>('');
  const [sources, setSources] = useState<{ id: number; title: string }[]>([]);
  const [assignees, setAssignees] = useState<{ username: string; full_name: string }[]>([]);

  // report
  const [report, setReport] = useState<PipelineReport | null>(null);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportSource, setReportSource] = useState<number | ''>('');

  // drawer
  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [leadNotes, setLeadNotes] = useState<Note[]>([]);
  const [noteBody, setNoteBody] = useState('');
  const [drawerLoading, setDrawerLoading] = useState(false);

  // ----- data loading -----
  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stageData, board] = await Promise.all([getStages(true), getBoard({})]);
      setStages(stageData.filter((s) => s.is_active));
      setLeads(board.leads);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rpt = await getReport({
        from: reportFrom || undefined,
        to: reportTo || undefined,
        source_id: typeof reportSource === 'number' ? reportSource : undefined,
      });
      setReport(rpt);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [reportFrom, reportTo, reportSource]);

  const loadMisc = useCallback(async () => {
    const [src, ass] = await Promise.all([listLeadSources(), listAssignees()]);
    setSources(src);
    setAssignees(ass);
  }, []);

  useEffect(() => {
    loadBoard();
    loadMisc();
  }, [loadBoard, loadMisc]);

  // ----- drag & drop -----
  const [dragOverStage, setDragOverStage] = useState<number | null>(null);
  /** Optimistic move shared by drag-and-drop, the per-card select and the drawer; reverts on a server error. */
  const doMove = async (leadId: number, targetStageId: number) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === targetStageId) return;
    const prevStage = lead.stage_id;
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage_id: targetStageId } : l)));
    setSelectedLead((cur) => (cur && cur.id === leadId ? { ...cur, stage_id: targetStageId } : cur));
    try {
      const card = await moveLead(leadId, targetStageId);
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, ...card } : l)));
      setSelectedLead((cur) => (cur && cur.id === leadId ? { ...cur, ...card } : cur));
    } catch (err: any) {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage_id: prevStage } : l)));
      setSelectedLead((cur) => (cur && cur.id === leadId ? { ...cur, stage_id: prevStage } : cur));
      setError(err.message);
    }
  };
  const onDragStart = (e: React.DragEvent<HTMLDivElement>, leadId: number) => {
    e.dataTransfer.setData('text/plain', String(leadId));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>, targetStageId: number) => {
    e.preventDefault();
    setDragOverStage(null);
    const leadId = Number(e.dataTransfer.getData('text/plain'));
    if (leadId) void doMove(leadId, targetStageId);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>, stageId: number) => {
    e.preventDefault();
    if (dragOverStage !== stageId) setDragOverStage(stageId);
  };

  // ----- drawer handling -----
  const openLead = async (lead: PipelineLead) => {
    setSelectedLead(lead);
    setDrawerLoading(true);
    try {
      setLeadNotes(await getLeadNotes(lead.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDrawerLoading(false);
    }
  };
  const closeLead = () => {
    setSelectedLead(null);
    setLeadNotes([]);
    setNoteBody('');
  };
  const saveNote = async () => {
    if (!selectedLead || !noteBody.trim()) return;
    try {
      await addLeadNote(selectedLead.id, noteBody.trim());
      setLeadNotes(await getLeadNotes(selectedLead.id));
      setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, notes_count: (l.notes_count || 0) + 1 } : l)));
      setNoteBody('');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const changeOwner = async (owner: string | null) => {
    if (!selectedLead) return;
    try {
      const r = await setLeadOwner(selectedLead.id, owner);
      setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, owner_username: r.owner_username } : l)));
      setSelectedLead({ ...selectedLead, owner_username: r.owner_username });
    } catch (e: any) {
      setError(e.message);
    }
  };

  // ----- render helpers -----
  const q = search.trim();
  const filteredLeads = leads.filter((l) => {
    if (q && !`${l.first_name ?? ''} ${l.last_name ?? ''} ${l.course_title ?? ''}`.includes(q)) return false;
    if (sourceFilter && l.source_id !== sourceFilter) return false;
    if (ownerFilter === '__none' ? !!l.owner_username : ownerFilter && l.owner_username !== ownerFilter) return false;
    return true;
  });

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">پایپ‌لاین سرنخ‌ها</h1>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          className={`px-4 py-2 ${activeTab === 'board' ? 'border-b-2 border-indigo-500' : ''}`}
          onClick={() => setActiveTab('board')}
        >
          بورد
        </button>
        <button
          className={`px-4 py-2 ${activeTab === 'report' ? 'border-b-2 border-indigo-500' : ''}`}
          onClick={() => {
            setActiveTab('report');
            if (!report) loadReport();
          }}
        >
          گزارش نرخ تبدیل
        </button>
        {isAdmin && (
          <button
            className={`px-4 py-2 ${activeTab === 'stages' ? 'border-b-2 border-indigo-500' : ''}`}
            onClick={() => setActiveTab('stages')}
          >
            مراحل
          </button>
        )}
      </div>

      {/* Error box */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl p-4">
          {error}
        </div>
      )}

      {/* Board Tab */}
      {activeTab === 'board' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="جستجو…"
              className={`${INPUT} w-full`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={`${INPUT} w-full`}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">همه منبع‌ها</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <select
              className={`${INPUT} w-full`}
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
            >
              <option value="">همه مسئول‌ها</option>
              <option value="__none">بدون مسئول</option>
              {assignees.map((a) => (
                <option key={a.username} value={a.username}>
                  {a.full_name}
                </option>
              ))}
            </select>
            <button
              className={BTN}
              onClick={loadBoard}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              تازه‌سازی
            </button>
          </div>

          {/* Board columns */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-indigo-600 w-12 h-12" />
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {stages
                .sort((a, b) => a.position - b.position)
                .map((stage) => {
                  const stageLeads = filteredLeads.filter((l) => l.stage_id === stage.id);
                  const colors = colorMap[stage.color];
                  return (
                    <div
                      key={stage.id}
                      className={`min-w-[260px] max-w-[300px] flex flex-col ${colors.bg} rounded-2xl border ${colors.border} p-2 transition ${dragOverStage === stage.id ? 'ring-2 ring-indigo-400' : ''}`}
                      onDrop={(e) => onDrop(e, stage.id)}
                      onDragOver={(e) => onDragOver(e, stage.id)}
                      onDragLeave={() => setDragOverStage((cur) => (cur === stage.id ? null : cur))}
                    >
                      <div className="flex items-center mb-2">
                        <span className={`w-3 h-3 rounded-full ${colors.dot} ml-2`}></span>
                        <h2 className={`font-medium ${colors.text}`}>{stage.title}</h2>
                        <span className="mr-auto text-xs text-slate-500">
                          {fa(stageLeads.length)}
                        </span>
                      </div>
                      <div className="flex-1 space-y-2">
                        {stageLeads.map((lead) => (
                          <div
                            key={lead.id}
                            className="bg-white rounded-2xl border border-slate-200 p-2 text-sm cursor-pointer shadow-sm"
                            draggable
                            onDragStart={(e) => onDragStart(e, lead.id)}
                            onClick={() => openLead(lead)}
                          >
                            <div className="font-medium">
                              {lead.first_name ? `${lead.first_name} ` : ''}
                              {lead.last_name}
                            </div>
                            <div dir="ltr" className="text-xs text-slate-500">
                              {lead.phone_masked}
                            </div>
                            {lead.source_title && (
                              <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-800">
                                {lead.source_title}
                              </span>
                            )}
                            {lead.course_title && (
                              <div className="text-xs text-slate-600">{lead.course_title}</div>
                            )}
                            {lead.owner_username && (
                              <div className="text-xs text-slate-600">
                                مسئول: {lead.owner_username}
                              </div>
                            )}
                            {lead.next_followup_date_jalali && (
                              <div className="text-xs text-slate-600">
                                پیگیری: {lead.next_followup_date_jalali}
                              </div>
                            )}
                            <div className="text-xs text-slate-500 mt-1">
                              یادداشت‌ها: {fa(lead.notes_count)}
                            </div>
                            {/* fallback for touch devices (no HTML5 drag-and-drop) */}
                            <select
                              aria-label="انتقال به مرحله"
                              className={`${INPUT} mt-2 w-full py-1`}
                              value=""
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { const v = Number(e.target.value); if (v) void doMove(lead.id, v); }}
                            >
                              <option value="">انتقال به…</option>
                              {stages.filter((x) => x.id !== lead.stage_id).map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.title}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}

      {/* Report Tab */}
      {activeTab === 'report' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="مثال: ۱۴۰۵/۰۱/۰۱"
              className={`${INPUT} w-full`}
              value={reportFrom}
              onChange={(e) => setReportFrom(e.target.value)}
            />
            <input
              type="text"
              placeholder="مثال: ۱۴۰۵/۰۲/۰۱"
              className={`${INPUT} w-full`}
              value={reportTo}
              onChange={(e) => setReportTo(e.target.value)}
            />
            <select
              className={`${INPUT} w-full`}
              value={reportSource}
              onChange={(e) => setReportSource(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">همه منبع‌ها</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <button
              className={BTN}
              onClick={loadReport}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              نمایش
            </button>
          </div>

          {report && <ReportView report={report} />}
        </div>
      )}

      {/* Stages Tab (admin only) */}
      {activeTab === 'stages' && isAdmin && (
        <StagesAdminPanel reloadBoard={loadBoard} setError={setError} />
      )}

      {/* Lead Detail Drawer */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex bg-black/30" onClick={closeLead}>
          <div className="bg-white w-full max-w-md h-full p-4 overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button className="float-left" onClick={closeLead}>
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-xl font-semibold mb-2">
              {selectedLead.first_name ?? ''} {selectedLead.last_name}
            </h2>
            <div className="mb-2">
              <label className="block text-sm mb-1">مسئول</label>
              <select
                className={`${INPUT} w-full`}
                value={selectedLead.owner_username ?? ''}
                onChange={(e) => changeOwner(e.target.value || null)}
              >
                <option value="">بدون مسئول</option>
                {assignees.map((a) => (
                  <option key={a.username} value={a.username}>
                    {a.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm mb-1">مرحله</label>
              <select
                className={`${INPUT} w-full`}
                value={selectedLead.stage_id ?? ''}
                onChange={(e) => { const v = Number(e.target.value); if (v) void doMove(selectedLead.id, v); }}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <h3 className="text-lg font-medium mb-2">یادداشت‌ها</h3>
            {drawerLoading ? (
              <Loader2 className="animate-spin text-indigo-600" />
            ) : (
              <ul className="space-y-2 mb-4">
                {leadNotes.map((n) => (
                  <li key={n.id} className="border border-slate-200 rounded p-2 text-sm">
                    <div className="flex justify-between">
                      <span>{n.body}</span>
                      <span className="text-xs text-slate-500">{n.staff_username}</span>
                    </div>
                    <div className="text-xs text-slate-400">{n.occurred_at ? new Date(n.occurred_at).toLocaleString('fa-IR') : ''}</div>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              className={`${INPUT} w-full`}
              placeholder="یادداشت جدید…"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            />
            <button className={BTN} onClick={saveNote} disabled={!noteBody}>
              افزودن یادداشت
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Conversion report (CSS charts, no chart library)
   ------------------------------------------------------------------------- */
function ReportView({ report }: { report: PipelineReport }) {
  const maxPeriod = Math.max(1, ...report.by_period.map((p) => p.leads));
  const kpis = [
    { label: 'کل سرنخ‌ها', value: fa(report.totals.leads), cls: 'text-slate-800' },
    { label: 'تبدیل‌شده', value: fa(report.totals.won), cls: 'text-emerald-600' },
    { label: 'از دست رفته', value: fa(report.totals.lost), cls: 'text-rose-600' },
    { label: 'باز', value: fa(report.totals.open), cls: 'text-sky-600' },
    { label: 'نرخ تبدیل', value: pct(report.totals.conversion_rate), cls: 'text-indigo-600' },
    { label: 'میانگین روز تا تبدیل', value: report.avg_days_to_win === null ? '—' : fa(report.avg_days_to_win), cls: 'text-slate-800' },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
            <div className="text-[11px] text-slate-500">{k.label}</div>
            <div className={`mt-1 text-lg font-bold ${k.cls}`}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">قیف مراحل (درصد سرنخ‌هایی که به هر مرحله رسیده‌اند)</h2>
        <div className="space-y-2">
          {report.by_stage.map((s) => (
            <div key={s.stage_id} className="flex items-center gap-2 text-xs">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colorMap[s.color]?.dot || 'bg-slate-500'}`} />
              <span className="w-28 shrink-0 truncate text-slate-700">{s.title}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                <div className={`h-4 rounded ${colorMap[s.color]?.dot || 'bg-slate-500'}`} style={{ width: `${Math.min(100, s.reach_rate * 100)}%` }} />
              </div>
              <span className="w-28 shrink-0 text-left text-slate-600">{pct(s.reach_rate)} · {fa(s.reached)} نفر</span>
              <span className="w-20 shrink-0 text-left text-slate-400">اکنون: {fa(s.current)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">نرخ تبدیل بر اساس منبع</h2>
        <table className="min-w-full text-xs">
          <thead className="text-slate-500">
            <tr><th className="p-2 text-right">منبع</th><th className="p-2">سرنخ</th><th className="p-2">تبدیل</th><th className="p-2">از دست رفته</th><th className="p-2 text-right">نرخ تبدیل</th></tr>
          </thead>
          <tbody>
            {report.by_source.map((r) => (
              <tr key={r.source_id ?? 'none'} className="border-t border-slate-100">
                <td className="p-2 text-slate-700">{r.title}</td>
                <td className="p-2 text-center">{fa(r.leads)}</td>
                <td className="p-2 text-center text-emerald-700">{fa(r.won)}</td>
                <td className="p-2 text-center text-rose-700">{fa(r.lost)}</td>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-32 overflow-hidden rounded bg-slate-100"><div className="h-2.5 rounded bg-indigo-500" style={{ width: `${Math.min(100, r.conversion_rate * 100)}%` }} /></div>
                    <span>{pct(r.conversion_rate)}</span>
                  </div>
                </td>
              </tr>
            ))}
            {!report.by_source.length && <tr><td colSpan={5} className="p-4 text-center text-slate-400">داده‌ای نیست.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">روند ماهانه (شمسی)</h2>
          <div className="flex gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-sky-400" /> سرنخ</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-emerald-500" /> تبدیل</span>
          </div>
        </div>
        {report.by_period.length ? (
          <div className="flex h-48 items-end gap-3 overflow-x-auto pb-1">
            {report.by_period.map((p) => (
              <div key={p.period} className="flex min-w-[52px] flex-col items-center gap-1">
                <span className="text-[10px] text-indigo-600">{pct(p.conversion_rate)}</span>
                <div className="flex h-32 items-end gap-1">
                  <div className="w-4 rounded-t bg-sky-400" style={{ height: `${(p.leads / maxPeriod) * 100}%` }} title={`سرنخ: ${fa(p.leads)}`} />
                  <div className="w-4 rounded-t bg-emerald-500" style={{ height: `${(p.won / maxPeriod) * 100}%` }} title={`تبدیل: ${fa(p.won)}`} />
                </div>
                <span className="text-[10px] text-slate-500">{p.period.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])}</span>
                <span className="text-[10px] text-slate-400">{fa(p.leads)} / {fa(p.won)}</span>
              </div>
            ))}
          </div>
        ) : <div className="p-4 text-center text-xs text-slate-400">داده‌ای نیست.</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Stage configuration (admin): loads all stages (including inactive)
   ------------------------------------------------------------------------- */
type StageDraft = { title: string; color: StageColor; status_key: string | null; is_won: boolean; is_lost: boolean; is_active: boolean };
const emptyStage: StageDraft = { title: '', color: 'slate', status_key: null, is_won: false, is_lost: false, is_active: true };

function StageFields({ value, onChange }: { value: StageDraft; onChange: (v: StageDraft) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${INPUT} w-40`} placeholder="عنوان مرحله" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      <select className={INPUT} value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value as StageColor })}>
        {Object.keys(colorMap).map((c) => <option key={c} value={c}>{COLOR_FA[c] || c}</option>)}
      </select>
      <select className={INPUT} value={value.status_key ?? ''} onChange={(e) => onChange({ ...value, status_key: e.target.value || null })} title="وضعیت متناظر در صفحه سرنخ‌ها">
        <option value="">بدون وضعیت متناظر</option>
        {Object.entries(LEGACY_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={value.is_won} onChange={(e) => onChange({ ...value, is_won: e.target.checked, is_lost: e.target.checked ? false : value.is_lost })} /> موفق (تبدیل)</label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={value.is_lost} onChange={(e) => onChange({ ...value, is_lost: e.target.checked, is_won: e.target.checked ? false : value.is_won })} /> از دست رفته</label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={value.is_active} onChange={(e) => onChange({ ...value, is_active: e.target.checked })} /> فعال</label>
    </div>
  );
}

function StagesAdminPanel({ reloadBoard, setError }: { reloadBoard: () => void; setError: (msg: string | null) => void }) {
  const [list, setList] = useState<Stage[]>([]);
  const [drafts, setDrafts] = useState<Record<number, StageDraft>>({});
  const [newStage, setNewStage] = useState<StageDraft>(emptyStage);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = (await getStages(true)).sort((a, b) => a.position - b.position);
      setList(all);
      setDrafts(Object.fromEntries(all.map((s) => [s.id, { title: s.title, color: s.color, status_key: s.status_key, is_won: s.is_won, is_lost: s.is_lost, is_active: s.is_active }])));
    } catch (e: any) { setError(e.message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); reloadBoard(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir; if (j < 0 || j >= list.length) return;
    const ids = list.map((s) => s.id); [ids[idx], ids[j]] = [ids[j], ids[idx]];
    void run(() => reorderStages(ids));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        هر مرحله می‌تواند به یک «وضعیت» صفحه سرنخ‌ها متصل باشد؛ با انتقال سرنخ به آن مرحله، وضعیت سرنخ هم به‌روز می‌شود. مرحله‌ای که سرنخ دارد حذف نمی‌شود؛ آن را غیرفعال کنید.
      </div>
      {list.map((s, idx) => (
        <div key={s.id} className={`flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-3 ${s.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
          <span className={`h-3 w-3 rounded-full ${colorMap[s.color]?.dot || 'bg-slate-500'}`} />
          <span className="w-10 text-[11px] text-slate-400">{fa(s.lead_count)} سرنخ</span>
          {drafts[s.id] && <StageFields value={drafts[s.id]} onChange={(v) => setDrafts((d) => ({ ...d, [s.id]: v }))} />}
          <div className="mr-auto flex gap-1">
            <button className={BTN_LIGHT} disabled={busy || idx === 0} onClick={() => move(idx, -1)} aria-label="بالا"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button className={BTN_LIGHT} disabled={busy || idx === list.length - 1} onClick={() => move(idx, 1)} aria-label="پایین"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button className={BTN_LIGHT} disabled={busy} onClick={() => run(() => updateStage(s.id, drafts[s.id]))}><Save className="h-3.5 w-3.5" /> ذخیره</button>
            <button className={`${BTN_LIGHT} text-rose-700`} disabled={busy} onClick={() => { if (window.confirm(`مرحله «${s.title}» حذف شود؟`)) void run(() => deleteStage(s.id)); }}><Trash2 className="h-3.5 w-3.5" /> حذف</button>
          </div>
        </div>
      ))}
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">افزودن مرحله</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StageFields value={newStage} onChange={setNewStage} />
          <button className={BTN} disabled={busy || !newStage.title.trim()} onClick={() => run(async () => { await createStage(newStage); setNewStage(emptyStage); })}>
            <Plus className="h-3.5 w-3.5" /> افزودن
          </button>
        </div>
      </div>
    </div>
  );
}
