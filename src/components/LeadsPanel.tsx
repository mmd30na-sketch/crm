import React, { useEffect, useMemo, useRef, useState } from 'react';
import FilterSheet from './FilterSheet';
import { Contact, Plus, Search, X, Loader2, UserCheck, ClipboardList, Edit3 } from 'lucide-react';
import {
  listLeads, listLeadSources, createLead, updateLead, convertLead, createTask, LEAD_STATUS_LABEL, utc,
  type LeadStatus, type Lead, type LeadInput,
} from '../api/phase4';
import { Course } from '../types';
import ModalPortal from './ModalPortal';
import ActivityTimeline from './ActivityTimeline';
import { RubikaContactButton, RubikaBulkContactsButton } from './RubikaContacts';
import { searchKey, toLatinDigits, normalizeNationalCode, normalizeJalaliDate, jalaliToday, checkNationalCode } from '../utils/normalize';

const ALL_STATUSES: LeadStatus[] = ['new', 'contacted', 'in_negotiation', 'converted', 'lost'];
const STATUS_COLOR: Record<LeadStatus, string> = {
  new: 'bg-sky-50 text-sky-700 border-sky-200',
  contacted: 'bg-amber-50 text-amber-700 border-amber-200',
  in_negotiation: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  converted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost: 'bg-rose-50 text-rose-700 border-rose-200',
};
const inputCls = 'w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300';

type LeadSource = { id: number; title: string; code: string | null };

interface LeadFormState {
  first_name: string; last_name: string; phone_number: string; national_code: string;
  source_id: string; course_id: string; status: LeadStatus; next_followup_date_jalali: string;
  loss_reason: string; notes: string;
}
const emptyForm: LeadFormState = {
  first_name: '', last_name: '', phone_number: '', national_code: '',
  source_id: '', course_id: '', status: 'new', next_followup_date_jalali: '', loss_reason: '', notes: '',
};
function leadToForm(l: Lead): LeadFormState {
  return {
    first_name: l.first_name ?? '', last_name: l.last_name ?? '', phone_number: l.phone_number ?? '',
    national_code: l.national_code ?? '', source_id: l.source_id != null ? String(l.source_id) : '',
    course_id: l.course_id != null ? String(l.course_id) : '', status: l.status,
    next_followup_date_jalali: l.next_followup_date_jalali ?? '', loss_reason: l.loss_reason ?? '', notes: l.notes ?? '',
  };
}
function leadDisplayName(l: Lead): string {
  return l.first_name ? `${l.first_name} ${l.last_name}` : l.last_name;
}
function isFollowupDue(l: Lead, today: string): boolean {
  const due = normalizeJalaliDate(l.next_followup_date_jalali || '');
  return !!due && due <= today && l.status !== 'converted' && l.status !== 'lost';
}

export default function LeadsPanel(props: { courses: Course[]; onConverted?: (studentId: number) => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [sources, setSources] = useState<LeadSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<'all' | LeadStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [followupOnly, setFollowupOnly] = useState(false);
  const today = useMemo(() => jalaliToday(), []);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [form, setForm] = useState<LeadFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [convertCode, setConvertCode] = useState('');
  const [converting, setConverting] = useState(false);
  // Synchronous guard: the disabled attribute only lands after the next render, so two fast clicks
  // could otherwise start two conversions before React re-renders the button.
  const convertingRef = useRef(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertMsg, setConvertMsg] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskSuccess, setTaskSuccess] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    Promise.all([listLeads(), listLeadSources()])
      .then(([ls, srcs]) => { setLeads(ls); setSources(srcs); })
      .catch((e: any) => { setLeads(prev => prev ?? []); setLoadError(e?.message || 'خواندن سرنخ‌ها ممکن نشد.'); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const tabCounts = useMemo(() => {
    const list = leads || [];
    const counts: Record<string, number> = { all: list.length };
    for (const s of ALL_STATUSES) counts[s] = list.filter(l => l.status === s).length;
    return counts;
  }, [leads]);

  const visibleLeads = useMemo(() => {
    const list = leads || [];
    const qKey = searchKey(searchTerm);
    const qDigits = toLatinDigits(searchTerm).replace(/\D/g, '');
    return list.filter(l => {
      if (tab !== 'all' && l.status !== tab) return false;
      if (searchTerm.trim()) {
        const matchesName = searchKey(leadDisplayName(l)).includes(qKey);
        const matchesPhone = qDigits ? toLatinDigits(l.phone_number).includes(qDigits) : false;
        if (!matchesName && !matchesPhone) return false;
      }
      if (followupOnly && !isFollowupDue(l, today)) return false;
      return true;
    });
  }, [leads, tab, searchTerm, followupOnly, today]);

  const openCreate = () => { setEditingLead(null); setForm(emptyForm); setFormError(null); setModalOpen(true); };
  const openEdit = (l: Lead) => { setEditingLead(l); setForm(leadToForm(l)); setFormError(null); setModalOpen(true); setSelectedLead(null); };

  const handleSaveLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.last_name.trim() || !form.phone_number.trim()) {
      setFormError('نام خانوادگی و موبایل الزامی است.');
      return;
    }
    setSaving(true); setFormError(null);
    try {
      const payload: LeadInput = {
        first_name: form.first_name.trim() || undefined,
        last_name: form.last_name.trim(),
        phone_number: toLatinDigits(form.phone_number).trim(),
        national_code: form.national_code.trim() ? normalizeNationalCode(form.national_code) : undefined,
        source_id: form.source_id ? Number(form.source_id) : undefined,
        course_id: form.course_id ? Number(form.course_id) : undefined,
        status: form.status,
        next_followup_date_jalali: form.next_followup_date_jalali.trim()
          ? (normalizeJalaliDate(form.next_followup_date_jalali) || form.next_followup_date_jalali.trim())
          : undefined,
        loss_reason: form.status === 'lost' ? (form.loss_reason.trim() || undefined) : undefined,
        notes: form.notes.trim() || undefined,
      };
      if (editingLead) await updateLead(editingLead.id, payload);
      else await createLead(payload);
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || 'ذخیره سرنخ ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const closeDrawer = () => {
    setSelectedLead(null);
    setConvertCode(''); setConvertError(null); setConvertMsg(null); setConverting(false); convertingRef.current = false;
    setTaskTitle(''); setTaskDue(''); setTaskError(null); setTaskSuccess(null); setTaskSaving(false);
  };

  const doConvert = async () => {
    if (!selectedLead) return;
    if (convertingRef.current) return; // already converting: ignore the second click
    convertingRef.current = true;
    setConverting(true); setConvertError(null);
    try {
      let code: string | undefined;
      if (!selectedLead.national_code) {
        const check = checkNationalCode(convertCode);
        if (check.error) { setConvertError(check.error); setConverting(false); convertingRef.current = false; return; }
        code = check.code;
      }
      const res = await convertLead(selectedLead.id, code);
      setConvertMsg(`به هنرجو تبدیل شد (پرونده #${res.student_id})`);
      setSelectedLead(prev => prev ? { ...prev, status: 'converted', converted_student_id: res.student_id } : prev);
      props.onConverted?.(res.student_id);
      load();
    } catch (err: any) {
      setConvertError(err?.message || 'تبدیل به هنرجو ناموفق بود.');
    } finally {
      convertingRef.current = false;
      setConverting(false);
    }
  };

  const addFollowupTask = async () => {
    if (!selectedLead) return;
    setTaskSaving(true); setTaskError(null); setTaskSuccess(null);
    try {
      await createTask({
        title: taskTitle.trim() || `پیگیری ${leadDisplayName(selectedLead)}`,
        due_at: taskDue ? new Date(taskDue).toISOString() : undefined,
        entity_type: 'lead',
        entity_id: selectedLead.id,
        priority: 'normal',
      });
      setTaskSuccess('کار پیگیری ثبت شد.');
      setTaskTitle(''); setTaskDue('');
    } catch (err: any) {
      setTaskError(err?.message || 'ثبت کار پیگیری ناموفق بود.');
    } finally {
      setTaskSaving(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
              <Contact className="w-4 h-4 text-indigo-600" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">سرنخ‌ها و پیگیری تماس‌ها</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">افرادی که تماس گرفته‌اند ولی هنوز ثبت‌نام نکرده‌اند</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
          <RubikaBulkContactsButton kind="lead" />
          <button type="button" onClick={openCreate}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 inline-flex items-center gap-1 cursor-pointer">
            <Plus className="w-3.5 h-3.5" />سرنخ جدید
          </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <FilterSheet title="فیلتر سرنخ‌ها" count={(tab !== 'all' ? 1 : 0) + (followupOnly ? 1 : 0)} onClear={() => { setTab('all'); setFollowupOnly(false); }}
          mobileExtra={<label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer"><input type="checkbox" checked={followupOnly} onChange={e => setFollowupOnly(e.target.checked)} />فقط پیگیری‌های امروز و گذشته</label>}>
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {(['all', ...ALL_STATUSES] as Array<'all' | LeadStatus>).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer inline-flex items-center gap-1 ${t === tab ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              {t === 'all' ? 'همه' : LEAD_STATUS_LABEL[t]}
              <span className="text-[10px] opacity-70">{tabCounts[t] ?? 0}</span>
            </button>
          ))}
        </div>
        </FilterSheet>

        <div className="flex items-center gap-3 flex-wrap mb-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="نام یا موبایل..."
              className="w-full text-xs border border-slate-200 rounded-lg pr-8 pl-2 py-1.5 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <label className="hidden lg:flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={followupOnly} onChange={e => setFollowupOnly(e.target.checked)} />فقط پیگیری‌های امروز و گذشته
          </label>
        </div>

        {loadError && <div role="alert" className="mb-2 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-md">{loadError}</div>}

        {leads === null ? (
          <div className="text-xs text-slate-400 py-6 text-center flex items-center justify-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />در حال بارگذاری...
          </div>
        ) : visibleLeads.length === 0 ? (
          <div className="text-xs text-slate-400 py-6 text-center">سرنخی ثبت نشده است</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs text-right">
              <thead><tr className="text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="p-2 font-semibold">نام</th>
                <th className="p-2 font-semibold">موبایل</th>
                <th className="p-2 font-semibold">منبع</th>
                <th className="p-2 font-semibold">دوره مورد علاقه</th>
                <th className="p-2 font-semibold">وضعیت</th>
                <th className="p-2 font-semibold">پیگیری بعدی</th>
                <th className="p-2 font-semibold">ثبت</th>
              </tr></thead>
              <tbody>
                {visibleLeads.map(l => (
                  <tr key={l.id} onClick={() => setSelectedLead(l)}
                    className="border-b border-slate-100 last:border-0 hover:bg-indigo-50/40 transition cursor-pointer align-middle">
                    <td className="p-2 font-bold text-slate-800">{leadDisplayName(l)}</td>
                    <td className="p-2"><bdi dir="ltr" className="font-mono text-slate-600">{l.phone_number}</bdi></td>
                    <td className="p-2 text-slate-600">{l.source_title || '—'}</td>
                    <td className="p-2 text-slate-600">{l.course_title || '—'}</td>
                    <td className="p-2"><span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${STATUS_COLOR[l.status]}`}>{LEAD_STATUS_LABEL[l.status]}</span></td>
                    <td className="p-2"><span className={isFollowupDue(l, today) ? 'text-rose-600 font-bold' : 'text-slate-500'}>{l.next_followup_date_jalali || '—'}</span></td>
                    <td className="p-2 text-slate-500 whitespace-nowrap">{utc(l.created_at)?.toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' }) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <ModalPortal>
          <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 w-full max-w-md space-y-3 text-slate-800 shadow-2xl">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">{editingLead ? 'ویرایش سرنخ' : 'سرنخ جدید'}</h4>
                <button type="button" onClick={() => setModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <form onSubmit={handleSaveLead} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <LeadField label="نام"><input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className={inputCls} /></LeadField>
                  <LeadField label="نام خانوادگی" required><input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className={inputCls} /></LeadField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <LeadField label="موبایل" required><input dir="ltr" value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} className={`${inputCls} text-left`} /></LeadField>
                  <LeadField label="کد ملی"><input dir="ltr" value={form.national_code} onChange={e => setForm(f => ({ ...f, national_code: e.target.value }))} className={`${inputCls} text-left`} /></LeadField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <LeadField label="منبع">
                    <select value={form.source_id} onChange={e => setForm(f => ({ ...f, source_id: e.target.value }))} className={inputCls}>
                      <option value="">—</option>
                      {(sources || []).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                  </LeadField>
                  <LeadField label="دوره مورد علاقه">
                    <select value={form.course_id} onChange={e => setForm(f => ({ ...f, course_id: e.target.value }))} className={inputCls}>
                      <option value="">—</option>
                      {props.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </LeadField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <LeadField label="وضعیت">
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as LeadStatus }))} className={inputCls}>
                      {ALL_STATUSES.map(s => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
                    </select>
                  </LeadField>
                  <LeadField label="پیگیری بعدی">
                    <input dir="ltr" value={form.next_followup_date_jalali} onChange={e => setForm(f => ({ ...f, next_followup_date_jalali: e.target.value }))} placeholder="۱۴۰۵/۰۸/۰۱" className={`${inputCls} text-left`} />
                  </LeadField>
                </div>
                {form.status === 'lost' && (
                  <LeadField label="دلیل انصراف"><input value={form.loss_reason} onChange={e => setForm(f => ({ ...f, loss_reason: e.target.value }))} className={inputCls} /></LeadField>
                )}
                <LeadField label="یادداشت"><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={`${inputCls} resize-none`} /></LeadField>
                {formError && <div role="alert" className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-md">{formError}</div>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50 cursor-pointer">انصراف</button>
                  <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer">{saving ? 'در حال ذخیره...' : 'ذخیره'}</button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {selectedLead && (
        <ModalPortal>
          <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 w-full max-w-lg space-y-4 text-slate-800 shadow-2xl my-auto">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">{leadDisplayName(selectedLead)}</h4>
                <button type="button" onClick={closeDrawer} aria-label="بستن" className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <DetailRow label="موبایل" value={<bdi dir="ltr" className="font-mono">{selectedLead.phone_number}</bdi>} />
                <DetailRow label="کد ملی" value={selectedLead.national_code ? <bdi dir="ltr" className="font-mono">{selectedLead.national_code}</bdi> : '—'} />
                <DetailRow label="منبع" value={selectedLead.source_title || '—'} />
                <DetailRow label="دوره مورد علاقه" value={selectedLead.course_title || '—'} />
                <DetailRow label="وضعیت" value={<span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${STATUS_COLOR[selectedLead.status]}`}>{LEAD_STATUS_LABEL[selectedLead.status]}</span>} />
                <DetailRow label="پیگیری بعدی" value={selectedLead.next_followup_date_jalali || '—'} />
              </div>
              {selectedLead.loss_reason && <DetailRow label="دلیل انصراف" value={selectedLead.loss_reason} />}
              {selectedLead.notes && <DetailRow label="یادداشت" value={<span className="whitespace-pre-wrap">{selectedLead.notes}</span>} />}

              <div className="flex items-center gap-2 flex-wrap border-t border-slate-100 pt-3">
                <button type="button" onClick={() => openEdit(selectedLead)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer">
                  <Edit3 className="w-3.5 h-3.5" />ویرایش
                </button>

                {selectedLead.status === 'converted' ? (
                  <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                    تبدیل‌شده به هنرجو #{selectedLead.converted_student_id}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    {!selectedLead.national_code && (
                      <input dir="ltr" value={convertCode} onChange={e => setConvertCode(e.target.value)} placeholder="کد ملی ۱۰ رقمی"
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-32 text-left focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    )}
                    <button type="button" disabled={converting} onClick={doConvert}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer">
                      <UserCheck className="w-3.5 h-3.5" />{converting ? 'در حال تبدیل...' : 'تبدیل به هنرجو'}
                    </button>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 pt-3"><RubikaContactButton kind="lead" id={selectedLead.id} /></div>
              {convertError && <div role="alert" className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-md">{convertError}</div>}
              {convertMsg && <div className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">{convertMsg}</div>}

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" />افزودن کار پیگیری</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder={`پیگیری ${leadDisplayName(selectedLead)}`}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 flex-1 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <input type="datetime-local" value={taskDue} onChange={e => setTaskDue(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <button type="button" disabled={taskSaving} onClick={addFollowupTask}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer">
                    {taskSaving ? '...' : 'ثبت'}
                  </button>
                </div>
                {taskError && <div role="alert" className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-md">{taskError}</div>}
                {taskSuccess && <div className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">{taskSuccess}</div>}
              </div>

              <ActivityTimeline entityType="lead" entityId={selectedLead.id} compact />
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

function LeadField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">{label}{required && <span className="text-rose-500 mr-1">*</span>}</label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-slate-700 font-semibold mt-0.5">{value}</div>
    </div>
  );
}
