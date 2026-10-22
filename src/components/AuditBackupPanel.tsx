import React, { useEffect, useState } from 'react';
import { History, HardDriveDownload, RefreshCw, Download } from 'lucide-react';
import * as api from '../api/client';
import { downloadCsv } from '../utils/exportCsv';

const ENTITY_LABEL: Record<string, string> = {
  students: 'هنرجو', enrollments: 'ثبت‌نام دوره', payments: 'پرداخت', expenses: 'هزینه', registrations: 'ثبت‌نام سایت',
  courses: 'دوره', staff: 'کاربر', settings: 'تنظیمات', messenger: 'پیام‌رسان', auth: 'ورود', 'dashboard-notes': 'یادداشت داشبورد',
  'receipt-settings': 'تنظیمات رسید', ocr: 'OCR', imports: 'ورود اطلاعات',
};
const METHOD_LABEL: Record<string, string> = { POST: 'ایجاد/عملیات', PUT: 'ویرایش', PATCH: 'ویرایش', DELETE: 'حذف' };

const fmtDate = (iso: string) => {
  try { return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z').toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }); } catch { return iso; }
};
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function AuditBackupPanel() {
  const [rows, setRows] = useState<api.AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(0);
  const [backups, setBackups] = useState<api.BackupFile[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const PAGE = 50;

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [a, b] = await Promise.all([api.getAuditLog({ limit: PAGE, offset: page * PAGE, entity }), api.getBackups()]);
      setRows(a.rows); setTotal(a.total); setBackups(b.files);
    } catch (e: any) { setErr(e.message || 'خطا'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [entity, page]);

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><HardDriveDownload className="w-4 h-4 text-emerald-600" />بکاپ خودکار دیتابیس</h4>
          <span className="text-[11px] text-slate-500">هر شب ساعت ۳ بامداد · نگهداری ۱۴ روز</span>
        </div>
        {backups === null ? <p className="text-xs text-slate-400">در حال بررسی...</p>
          : backups.length === 0 ? <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">هنوز هیچ بکاپی ثبت نشده است.</p>
          : (
            <div className="text-xs space-y-1">
              <p className={`font-bold ${Date.now() - new Date(backups[0].mtime).getTime() > 36 * 3600e3 ? 'text-rose-600' : 'text-emerald-700'}`}>
                آخرین بکاپ: {fmtDate(backups[0].mtime)} ({fmtSize(backups[0].size)}) · تعداد: {backups.length.toLocaleString('fa-IR')}
              </p>
              <details><summary className="cursor-pointer text-slate-500">همه بکاپ‌ها</summary>
                <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-slate-600" dir="ltr">
                  {backups.map((f) => <li key={f.name}>{f.name} — {fmtSize(f.size)}</li>)}
                </ul>
              </details>
            </div>
          )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><History className="w-4 h-4 text-indigo-600" />گزارش تغییرات (چه کسی، چه چیزی، کی)</h4>
          <div className="flex items-center gap-2">
            <select value={entity} onChange={(e) => { setPage(0); setEntity(e.target.value); }} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
              <option value="">همه بخش‌ها</option>
              {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button onClick={() => downloadCsv<api.AuditRow>(`audit-${new Date().toISOString().slice(0, 10)}`, rows, [
              { header: 'زمان', value: (r) => fmtDate(r.created_at) }, { header: 'کاربر', value: (r) => r.username },
              { header: 'نقش', value: (r) => r.role }, { header: 'عملیات', value: (r) => METHOD_LABEL[r.method] || r.method },
              { header: 'بخش', value: (r) => ENTITY_LABEL[r.entity || ''] || r.entity }, { header: 'شناسه', value: (r) => r.entity_id },
              { header: 'مسیر', value: (r) => r.path }, { header: 'نتیجه', value: (r) => r.status },
            ])} className="text-xs flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50"><Download className="w-3.5 h-3.5" />اکسل</button>
            <button onClick={load} className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50" title="بارگذاری دوباره"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="p-2 font-bold">زمان</th><th className="p-2 font-bold">کاربر</th><th className="p-2 font-bold">عملیات</th>
              <th className="p-2 font-bold">بخش</th><th className="p-2 font-bold">شناسه</th><th className="p-2 font-bold">نتیجه</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">موردی ثبت نشده است</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="p-2" dir="ltr">{r.username || '—'}</td>
                  <td className="p-2">{METHOD_LABEL[r.method] || r.method}</td>
                  <td className="p-2">{ENTITY_LABEL[r.entity || ''] || r.entity}<span className="block text-[10px] text-slate-400 font-mono" dir="ltr">{r.path}</span></td>
                  <td className="p-2 font-mono" dir="ltr">{r.entity_id || '—'}</td>
                  <td className="p-2">{r.status && r.status < 400
                    ? <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">موفق</span>
                    : <span className="text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">ناموفق {r.status}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>مجموع: {total.toLocaleString('fa-IR')}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 border rounded disabled:opacity-40">قبلی</button>
            <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)} className="px-2 py-1 border rounded disabled:opacity-40">بعدی</button>
          </div>
        </div>
      </div>
    </div>
  );
}
