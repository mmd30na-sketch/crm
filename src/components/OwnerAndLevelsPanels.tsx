// «صاحب کسب‌وکار» and «سطوح و کاربران» sub-sections of Settings → تنظیمات هم‌راز.
// The server enforces everything (accessLevels.ts middleware); this UI only edits it.
import React, { useEffect, useState } from 'react';
import { Phone, Send, MessageCircle, Save, Plus, Trash2, ShieldCheck, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import * as api from '../api/accessLevels';

const inputCls = 'w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50';
const BASE_LABEL: Record<string, string> = { admin: 'مدیر (همه بخش‌ها)', cashier: 'صندوقدار', instructor: 'مربی' };

function Note({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <div className={`text-[11px] flex items-center gap-1 ${m.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{m.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}{m.text}</div>;
}

export function BusinessOwnerForm() {
  const [o, setO] = useState<api.OwnerContact>({});
  const [links, setLinks] = useState<api.OwnerContact['links']>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.getOwner().then((x) => { setO(x); setLinks(x.links); }).catch((e) => setMsg({ ok: false, text: e.message })); }, []);
  const save = async () => {
    setSaving(true); setMsg(null);
    try { const x = await api.saveOwner({ name: o.name, phone: o.phone, telegram: o.telegram, rubika: o.rubika, bale: o.bale }); setO(x); setLinks(x.links); setMsg({ ok: true, text: 'ذخیره شد.' }); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setSaving(false); }
  };
  const field = (k: keyof api.OwnerContact, label: string, ph: string) => (
    <label className="block text-[11px] font-semibold text-slate-600">{label}
      <input dir="ltr" className={`${inputCls} mt-1 font-mono`} placeholder={ph} value={String(o[k] || '')} onChange={(e) => setO({ ...o, [k]: e.target.value })} />
    </label>
  );
  const icons: { k: 'phone' | 'telegram' | 'rubika' | 'bale'; label: string; Icon: typeof Phone; cls: string }[] = [
    { k: 'phone', label: 'تماس', Icon: Phone, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { k: 'telegram', label: 'تلگرام', Icon: Send, cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    { k: 'rubika', label: 'روبیکا', Icon: MessageCircle, cls: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
    { k: 'bale', label: 'بله', Icon: MessageCircle, cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  ];
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500">هم‌راز برای «به صاحب کسب‌وکار خبر بده» از این اطلاعات استفاده می‌کند؛ ارسال پیام همچنان طبق قوانین تأیید هم‌راز است.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-[11px] font-semibold text-slate-600">نام
          <input className={`${inputCls} mt-1`} value={o.name || ''} onChange={(e) => setO({ ...o, name: e.target.value })} />
        </label>
        {field('phone', 'شماره تلفن', '09xxxxxxxxx')}
        {field('telegram', 'آیدی تلگرام', '@username')}
        {field('rubika', 'آیدی روبیکا', '@username')}
        {field('bale', 'آیدی بله', '@username')}
      </div>
      <div className="flex flex-wrap gap-2">
        {icons.map(({ k, label, Icon, cls }) => links?.[k]
          ? <a key={k} href={links[k]!} target={k === 'phone' ? undefined : '_blank'} rel="noopener noreferrer" title={links[k]!} className={`${btn} border ${cls}`}><Icon size={14} />{label}</a>
          : <span key={k} className={`${btn} border border-slate-200 text-slate-300`}><Icon size={14} />{label}</span>)}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={saving} onClick={save} className={`${btn} bg-sky-600 text-white`}><Save size={14} />ذخیره</button>
        <Note m={msg} />
      </div>
    </div>
  );
}

export function LevelsAndUsersPanel() {
  const [perms, setPerms] = useState<api.Perm[]>([]);
  const [levels, setLevels] = useState<api.Level[]>([]);
  const [users, setUsers] = useState<api.StaffUser[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newLv, setNewLv] = useState({ id: '', name: '', base_role: 'cashier' as api.BaseRole });
  const [newU, setNewU] = useState({ username: '', full_name: '', password: '', level_id: 'cashier' });
  const load = async () => {
    try { const [l, u] = await Promise.all([api.getLevels(), api.getStaff()]); setPerms(l.permissions); setLevels(l.levels); setUsers(u); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setMsg(null); try { await fn(); setMsg({ ok: true, text: ok }); await load(); } catch (e: any) { setMsg({ ok: false, text: e.message }); } };
  const togglePerm = (lv: api.Level, k: string) => setLevels(levels.map((x) => x.id === lv.id ? { ...x, permissions: { ...x.permissions, [k]: !x.permissions[k] } } : x));

  return (
    <div className="space-y-5">
      <Note m={msg} />
      <section>
        <h4 className="text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"><ShieldCheck size={14} />سطوح دسترسی</h4>
        <p className="text-[10px] text-slate-400 mb-2">«نقش پایه» سقف دسترسی است و ماتریس فقط می‌تواند آن را محدود کند (مثلاً حسابدار = پایهٔ مدیر بدون تنظیمات و کاربران). «مدیر کل» همیشه دسترسی کامل دارد و قابل تغییر نیست. کنترل‌ها در سرور اعمال می‌شود.</p>
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="text-[11px] w-full">
            <thead className="bg-slate-50 text-slate-600"><tr>
              <th className="p-2 text-right">سطح</th><th className="p-2 text-right">نقش پایه</th>
              {perms.map((p) => <th key={p.key} className="p-1 font-semibold text-center whitespace-nowrap">{p.label}</th>)}
              <th className="p-2" />
            </tr></thead>
            <tbody>
              {levels.map((lv) => {
                const locked = lv.id === 'full_admin';
                return (
                  <tr key={lv.id} className="border-t border-slate-100">
                    <td className="p-2 whitespace-nowrap">
                      {locked ? <span className="font-bold flex items-center gap-1"><Lock size={11} />{lv.name}</span>
                        : <input className={`${inputCls} !py-1 w-28`} value={lv.name} onChange={(e) => setLevels(levels.map((x) => x.id === lv.id ? { ...x, name: e.target.value } : x))} />}
                      <div className="text-[9px] text-slate-400 font-mono">{lv.id} · {lv.users || 0} کاربر</div>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {lv.system ? BASE_LABEL[lv.base_role] : (
                        <select className={`${inputCls} !py-1`} value={lv.base_role} onChange={(e) => setLevels(levels.map((x) => x.id === lv.id ? { ...x, base_role: e.target.value as api.BaseRole } : x))}>
                          {Object.entries(BASE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>)}
                    </td>
                    {perms.map((p) => <td key={p.key} className="text-center"><input type="checkbox" className="accent-sky-600" disabled={locked} checked={!!lv.permissions[p.key]} onChange={() => togglePerm(lv, p.key)} /></td>)}
                    <td className="p-2 whitespace-nowrap">
                      {!locked && <div className="flex gap-1">
                        <button className={`${btn} bg-sky-50 text-sky-700 border border-sky-200`} onClick={() => run(() => api.updateLevel(lv.id, { name: lv.name, base_role: lv.base_role, permissions: lv.permissions }), 'سطح ذخیره شد.')}><Save size={12} /></button>
                        {!lv.system && <button className={`${btn} bg-rose-50 text-rose-600 border border-rose-200`} onClick={() => { if (confirm(`سطح «${lv.name}» حذف شود؟`)) run(() => api.deleteLevel(lv.id), 'سطح حذف شد.'); }}><Trash2 size={12} /></button>}
                      </div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2 mt-2">
          <input className={`${inputCls} !w-32`} placeholder="نام (مثلاً حسابدار)" value={newLv.name} onChange={(e) => setNewLv({ ...newLv, name: e.target.value })} />
          <input dir="ltr" className={`${inputCls} !w-32 font-mono`} placeholder="accountant" value={newLv.id} onChange={(e) => setNewLv({ ...newLv, id: e.target.value.toLowerCase() })} />
          <select className={`${inputCls} !w-40`} value={newLv.base_role} onChange={(e) => setNewLv({ ...newLv, base_role: e.target.value as api.BaseRole })}>
            {Object.entries(BASE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className={`${btn} bg-sky-600 text-white`} onClick={() => run(async () => { await api.createLevel({ ...newLv, permissions: {} }); setNewLv({ id: '', name: '', base_role: 'cashier' }); }, 'سطح جدید ساخته شد؛ دسترسی‌ها را تیک بزنید و ذخیره کنید.')}><Plus size={14} />سطح جدید</button>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-bold text-slate-700 mb-2">کاربران</h4>
        <div className="space-y-1.5">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-2 text-[11px] border border-slate-100 rounded-lg p-2">
              <span className="font-bold w-32 truncate">{u.full_name}</span>
              <span className="font-mono text-slate-500 w-24 truncate" dir="ltr">{u.username}</span>
              {u.locked ? <span className="text-slate-500 flex items-center gap-1"><Lock size={11} />مدیر کل (سیستمی)</span> : <>
                <select className={`${inputCls} !w-36 !py-1`} value={u.level_id || ''} onChange={(e) => run(() => api.updateStaff(u.id, { level_id: e.target.value }), 'سطح کاربر تغییر کرد.')}>
                  {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <label className="flex items-center gap-1"><input type="checkbox" className="accent-sky-600" checked={u.is_active} onChange={(e) => run(() => api.updateStaff(u.id, { is_active: e.target.checked }), 'وضعیت کاربر ذخیره شد.')} />فعال</label>
                <button className={`${btn} border border-slate-200 text-slate-600`} onClick={() => { const n = prompt('نام جدید', u.full_name); if (n && n !== u.full_name) run(() => api.updateStaff(u.id, { full_name: n }), 'نام ذخیره شد.'); }}>ویرایش نام</button>
                <button className={`${btn} border border-slate-200 text-slate-600`} onClick={() => { const p = prompt('رمز جدید (حداقل ۶ کاراکتر)'); if (p) run(() => api.updateStaff(u.id, { password: p }), 'رمز تغییر کرد.'); }}>تغییر رمز</button>
              </>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2 mt-2">
          <input className={`${inputCls} !w-32`} placeholder="نام و نام خانوادگی" value={newU.full_name} onChange={(e) => setNewU({ ...newU, full_name: e.target.value })} />
          <input dir="ltr" className={`${inputCls} !w-28 font-mono`} placeholder="username" value={newU.username} onChange={(e) => setNewU({ ...newU, username: e.target.value })} />
          <input dir="ltr" type="password" autoComplete="new-password" className={`${inputCls} !w-28`} placeholder="رمز" value={newU.password} onChange={(e) => setNewU({ ...newU, password: e.target.value })} />
          <select className={`${inputCls} !w-36`} value={newU.level_id} onChange={(e) => setNewU({ ...newU, level_id: e.target.value })}>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className={`${btn} bg-sky-600 text-white`} onClick={() => run(async () => { await api.createStaff(newU); setNewU({ username: '', full_name: '', password: '', level_id: 'cashier' }); }, 'کاربر ساخته شد.')}><Plus size={14} />کاربر جدید</button>
        </div>
      </section>
    </div>
  );
}
