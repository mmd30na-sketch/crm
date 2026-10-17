import { useEffect, useRef, useState } from 'react';
import { UserPlus, UserMinus, Users, Loader2, X } from 'lucide-react';
import * as api from '../api/client';
import ModalPortal from './ModalPortal';

type Kind = 'student' | 'lead';
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  added: { text: 'در مخاطبین روبیکا', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  already: { text: 'از قبل مخاطب/در گفتگو', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  not_on_rubika: { text: 'در روبیکا حساب ندارد', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  failed: { text: 'افزودن ناموفق', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const fa = (n: number) => n.toLocaleString('fa-IR');

/** Profile / lead detail: add this person to the main account's Rubika contacts (no message is sent). */
export function RubikaContactButton({ kind, id }: { kind: Kind; id: number }) {
  const [rec, setRec] = useState<api.RubikaContactStatus | null>(null);
  const [busy, setBusy] = useState<'add' | 'del' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    let alive = true; setNote(null); setRec(null); setConfirmDel(false);
    api.fetchRubikaContacts(kind).then(r => { if (alive) setRec(r.contacts?.[String(id)] || null); }).catch(() => {});
    return () => { alive = false; };
  }, [kind, id]);
  const add = async () => {
    setBusy('add'); setNote(null);
    try { const r = await api.addRubikaContact(kind, id); setRec(r); setNote({ ok: r.status !== 'failed', text: r.message }); }
    catch (e: any) { setNote({ ok: false, text: e?.message || 'افزودن ناموفق بود.' }); }
    finally { setBusy(null); }
  };
  const del = async () => {
    setBusy('del'); setNote(null);
    try { const r = await api.deleteRubikaContact(kind, id); setRec(null); setNote({ ok: true, text: r.message }); }
    catch (e: any) { setNote({ ok: false, text: e?.message || 'حذف ناموفق بود.' }); }
    finally { setBusy(null); setConfirmDel(false); }
  };
  const st = rec ? STATUS_LABEL[rec.status] : null;
  return (
    <div className="flex flex-col gap-1.5 w-full sm:w-auto" dir="rtl">
      <div className="flex items-center flex-wrap gap-2">
        {st && <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${st.cls}`}>{st.text}</span>}
        <button type="button" onClick={add} disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-60">
          {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}افزودن به مخاطبین روبیکا
        </button>
        {rec?.linked && (confirmDel ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={del} disabled={!!busy} className="px-3 py-2 bg-rose-600 text-white text-xs font-bold rounded-lg disabled:opacity-60">
              {busy === 'del' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'بله، حذف شود'}
            </button>
            <button type="button" onClick={() => setConfirmDel(false)} className="px-2 py-2 text-xs text-slate-500">انصراف</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDel(true)} disabled={!!busy} title="حذف از مخاطبین روبیکا"
            className="flex items-center gap-1 px-3 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-xs font-bold rounded-lg">
            <UserMinus className="w-3.5 h-3.5" />حذف مخاطب
          </button>
        ))}
      </div>
      {note && <p className={`text-[11px] ${note.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{note.text}</p>}
    </div>
  );
}

const STOP_LABEL: Record<string, string> = { flood: 'روبیکا محدودیت تعداد درخواست داد؛ متوقف شد.', errors: 'سه خطای پشت سر هم؛ متوقف شد.', cancelled: 'متوقف شد.', not_logged_in: 'اکانت اصلی روبیکا وارد نشده است.', error: 'اجرا با خطا متوقف شد.' };

/** List toolbar: add everyone (filtered) to Rubika contacts, 1 every 3-5 s, with progress and summary. */
export function RubikaBulkContactsButton({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  const [activeTerm, setActiveTerm] = useState(kind === 'student');
  const [unlinked, setUnlinked] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [job, setJob] = useState<api.RubikaContactJob | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const poll = () => api.fetchRubikaContactsBulk().then(r => setJob(r.bulk)).catch(() => {});
  useEffect(() => {
    if (!open) return;
    poll();
    timer.current = window.setInterval(poll, 2500);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [open]);
  useEffect(() => {
    if (!open || job?.running) return;
    setCount(null); setErr('');
    api.previewRubikaContactsBulk({ kind, active_term: kind === 'student' && activeTerm, unlinked }).then(r => setCount(r.count)).catch(e => setErr(e?.message || 'خطا'));
  }, [open, activeTerm, unlinked, kind, job?.running]);
  const start = async () => {
    setBusy(true); setErr('');
    try { const r = await api.startRubikaContactsBulk({ kind, active_term: kind === 'student' && activeTerm, unlinked }); setJob(r.bulk); }
    catch (e: any) { setErr(e?.message || 'شروع ناموفق بود.'); } finally { setBusy(false); }
  };
  const stop = async () => { try { const r = await api.stopRubikaContactsBulk(); setJob(r.bulk); } catch { /* poll catches up */ } };
  const mine = job && job.kind === kind ? job : null;
  const other = job && job.kind !== kind && job.running;
  const pct = mine && mine.total ? Math.round((mine.done / mine.total) * 100) : 0;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 text-[11px] font-bold rounded-lg transition cursor-pointer">
        <Users className="w-3 h-3" />افزودن همه به مخاطبین روبیکا
      </button>
      {open && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" dir="rtl" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-900">افزودن {kind === 'student' ? 'هنرجویان' : 'سرنخ‌ها'} به مخاطبین روبیکا</h3>
                <button type="button" onClick={() => setOpen(false)} className="p-1 text-slate-400" aria-label="بستن"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-slate-500 leading-6">فقط شماره‌ها به دفترچه مخاطبین اکانت اصلی اضافه می‌شوند؛ <b>هیچ پیامی برای کسی ارسال نمی‌شود.</b> هر ۳ تا ۵ ثانیه یک نفر؛ با محدودیت روبیکا یا خطاهای پشت سر هم خودکار متوقف می‌شود.</p>
              {other && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">یک افزودن گروهی دیگر ({job!.kind === 'student' ? 'هنرجویان' : 'سرنخ‌ها'}) در حال اجراست.</p>}
              {!mine?.running && !other && (
                <div className="space-y-2 text-xs">
                  {kind === 'student' && (
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={activeTerm} onChange={e => setActiveTerm(e.target.checked)} className="w-4 h-4" />فقط کارآموزان دوره‌های فعال</label>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={unlinked} onChange={e => setUnlinked(e.target.checked)} className="w-4 h-4" />فقط کسانی که هنوز اضافه/بررسی نشده‌اند</label>
                  {kind === 'lead' && <p className="text-[11px] text-slate-400">سرنخ‌های تبدیل‌شده یا ازدست‌رفته شامل نمی‌شوند.</p>}
                  <p className="font-bold text-slate-700">
                    {count === null ? 'در حال شمارش…' : `${fa(count)} نفر — حدود ${fa(Math.max(1, Math.ceil(count * 4 / 60)))} دقیقه`}
                  </p>
                </div>
              )}
              {mine && (
                <div className="space-y-2">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} /></div>
                  <p className="text-xs text-slate-600">{fa(mine.done)} از {fa(mine.total)} {mine.running ? '(در حال اجرا…)' : '— پایان'}</p>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <span className="bg-emerald-50 text-emerald-700 rounded-lg p-2">اضافه شد: {fa(mine.added)}</span>
                    <span className="bg-emerald-50 text-emerald-700 rounded-lg p-2">از قبل: {fa(mine.already)}</span>
                    <span className="bg-slate-50 text-slate-600 rounded-lg p-2">در روبیکا نیست: {fa(mine.not_on_rubika)}</span>
                    <span className="bg-rose-50 text-rose-700 rounded-lg p-2">ناموفق: {fa(mine.failed)}</span>
                  </div>
                  {!mine.running && mine.stopped && <p className="text-xs text-amber-700">{STOP_LABEL[mine.stopped] || mine.stopped}</p>}
                </div>
              )}
              {err && <p className="text-xs text-rose-600">{err}</p>}
              <div className="flex gap-2 justify-end">
                {mine?.running
                  ? <button type="button" onClick={stop} className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-lg">توقف</button>
                  : !other && (
                    <button type="button" onClick={start} disabled={busy || !count}
                      className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}تأیید و شروع ({fa(count || 0)} نفر)
                    </button>
                  )}
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-xs text-slate-600 border border-slate-200 rounded-lg">بستن</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
