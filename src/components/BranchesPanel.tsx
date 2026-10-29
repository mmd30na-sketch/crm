import { useState, useEffect } from 'react';
import { Building2, FileText, Plus, Edit, Save, X } from 'lucide-react';
import type { BranchConfig } from '../api/branches';
import {
  fetchBranchConfig as fetchBranchesConfig,
  fetchBranches,
  createBranch,
  updateBranch,
  setDefaultBranch,
  fetchUserBranches,
  updateUserBranches,
  fetchBranchReport
} from '../api/branches';

type Branch = {
  id: number;
  code: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  academy_name?: string | null;
  address?: string | null;
  phone?: string | null;
  sms_sender_line?: string | null;
  manager_name?: string | null;
  students?: number;
  enrollments?: number;
  users?: number;
};

type UserBranchAssignment = {
  username: string;
  full_name?: string;
  role?: string;
  branch_ids: number[];
};

type BranchReportRow = {
  branch_id: number | null;
  name: string;
  students: number;
  enrollments: number;
  tuition_total: number;
  paid_total: number;
  expenses_total: number;
  remaining_total: number;
};

export default function BranchesPanel() {
  const [activeTab, setActiveTab] = useState<'branches' | 'users' | 'report'>('branches');
  const [config, setConfig] = useState<BranchConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [userBranches, setUserBranches] = useState<UserBranchAssignment[]>([]);
  const [reportData, setReportData] = useState<{
    rows: BranchReportRow[];
    totals: Omit<BranchReportRow, 'branch_id' | 'name'>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');

  useEffect(() => {
    const loadData = async () => {
      setError(null);
      try {
        const configData = await fetchBranchesConfig();
        setConfig(configData);

        if (configData.enabled) {
          // The branch list is needed by every tab (user columns, report names).
          setBranches(await fetchBranches());
          if (activeTab === 'users') {
            setUserBranches(await fetchUserBranches());
          } else if (activeTab === 'report') {
            setReportData(await fetchBranchReport(reportFrom || undefined, reportTo || undefined));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'خطا در بارگذاری داده‌ها');
      } finally {
        setLoading(false);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, reloadKey]);
  const reload = (msg?: string) => { setNotice(msg || null); setReloadKey((k) => k + 1); };

  const handleCreateBranch = async (data: Partial<Branch>) => {
    try {
      await createBranch(data);
      setEditingBranch(null);
      reload('شعبه ساخته شد. برای دیدن انتخاب شعبه در بالای صفحه، صفحه را دوباره باز کنید.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد شعبه');
    }
  };

  const handleUpdateBranch = async (id: number, data: Partial<Branch>) => {
    try {
      await updateBranch(id, data);
      setEditingBranch(null);
      reload('تغییرات شعبه ذخیره شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در به‌روزرسانی شعبه');
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      if (!window.confirm('ردیف‌های بدون شعبه از این پس به این شعبه تعلق می‌گیرند. ادامه می‌دهید؟')) return;
      await setDefaultBranch(id);
      reload('شعبه پیش‌فرض عوض شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تنظیم شعبه پیش‌فرض');
    }
  };

  const handleAddUser = async () => {
    const name = newUsername.trim().toLowerCase();
    if (!name) return;

    try {
      if (!userBranches.some(u => u.username === name)) setUserBranches([...userBranches, { username: name, branch_ids: [] }]);
      setNewUsername('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در اضافه کردن کاربر');
    }
  };

  const handleUserBranchToggle = async (username: string, branchId: number) => {
    try {
      const user = userBranches.find(u => u.username === username);
      if (!user) return;

      const newBranchIds = user.branch_ids.includes(branchId)
        ? user.branch_ids.filter(id => id !== branchId)
        : [...user.branch_ids, branchId];

      await updateUserBranches(username, newBranchIds);
      setUserBranches(userBranches.map(u =>
        u.username === username ? { ...u, branch_ids: newBranchIds } : u
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در به‌روزرسانی دسترسی شعبه');
    }
  };

  const handleGenerateReport = async () => {
    try {
      const data = await fetchBranchReport(reportFrom, reportTo);
      setReportData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید گزارش');
    }
  };

  if (loading) {
    return <div className="text-center py-4">در حال بارگذاری...</div>;
  }

  if (!config?.enabled) {
    return (
      <div dir="rtl" className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-600">
            <Building2 className="w-5 h-5" />
            <h2 className="text-lg font-bold">چندشعبه فعال نیست</h2>
          </div>
          <p className="mt-2 text-slate-600">
            برای فعال‌سازی چندشعبه، متغیر محیطی <code>CRM_MULTI_BRANCH=1</code> را تنظیم کنید.
            این ویژگی فقط با MySQL کار می‌کند.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl flex items-center gap-2">
          <X className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="bg-emerald-50 text-emerald-700 px-4 py-3 rounded-xl text-sm">{notice}</div>
      )}

      {!config.multi && (
        <div className="bg-blue-50 text-blue-600 px-4 py-3 rounded-xl flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          <span>تا وقتی فقط یک شعبه فعال است، همه‌چیز مثل قبل کار می‌کند و انتخاب شعبه نمایش داده نمی‌شود.</span>
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('branches')}
          className={`px-4 py-2 rounded-t-xl text-sm font-medium ${
            activeTab === 'branches'
              ? 'bg-white border border-slate-200 border-b-white'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          شعبه‌ها
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-t-xl text-sm font-medium ${
            activeTab === 'users'
              ? 'bg-white border border-slate-200 border-b-white'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          کاربران و شعبه
        </button>
        <button
          onClick={() => setActiveTab('report')}
          className={`px-4 py-2 rounded-t-xl text-sm font-medium ${
            activeTab === 'report'
              ? 'bg-white border border-slate-200 border-b-white'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          گزارش شعب
        </button>
      </div>

      {activeTab === 'branches' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">شعبه‌ها</h2>
            <button
              onClick={() => setEditingBranch({
                id: 0,
                code: '',
                name: '',
                is_default: false,
                is_active: true
              })}
              className="bg-sky-600 text-white rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              شعبه جدید
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 text-right">کد</th>
                  <th className="py-2 px-3 text-right">نام شعبه</th>
                  <th className="py-2 px-3 text-right">هنرجو</th>
                  <th className="py-2 px-3 text-right">ثبت‌نام</th>
                  <th className="py-2 px-3 text-right">کاربران</th>
                  <th className="py-2 px-3 text-right">وضعیت</th>
                  <th className="py-2 px-3 text-right">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {branches.map(branch => (
                  <tr key={branch.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3">{branch.code}</td>
                    <td className="py-2 px-3">
                      {branch.name}
                      {branch.is_default && (
                        <span className="ms-2 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                          پیش‌فرض
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">{(branch.students || 0).toLocaleString('fa-IR')}</td>
                    <td className="py-2 px-3">{(branch.enrollments || 0).toLocaleString('fa-IR')}</td>
                    <td className="py-2 px-3">{(branch.users || 0).toLocaleString('fa-IR')}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        branch.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {branch.is_active ? 'فعال' : 'غیرفعال'}
                      </span>
                    </td>
                    <td className="py-2 px-3 flex gap-1">
                      <button
                        onClick={() => setEditingBranch(branch)}
                        className="text-slate-500 hover:text-slate-700"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      {!branch.is_default && (
                        <button
                          onClick={() => handleSetDefault(branch.id)}
                          className="text-slate-500 hover:text-slate-700"
                        >
                          پیش‌فرض کن
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editingBranch && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold">
                    {editingBranch.id ? 'ویرایش شعبه' : 'شعبه جدید'}
                  </h3>
                  <button
                    onClick={() => setEditingBranch(null)}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form
                  onSubmit={e => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const data: Partial<Branch> = {
                      code: formData.get('code') as string,
                      name: formData.get('name') as string,
                      academy_name: formData.get('academy_name') as string || undefined,
                      address: formData.get('address') as string || undefined,
                      phone: formData.get('phone') as string || undefined,
                      sms_sender_line: formData.get('sms_sender_line') as string || undefined,
                      manager_name: formData.get('manager_name') as string || undefined,
                      // A disabled checkbox is not submitted: the default branch always stays active.
                      is_active: editingBranch.is_default ? true : formData.get('is_active') === 'on'
                    };

                    if (editingBranch.id) {
                      handleUpdateBranch(editingBranch.id, data);
                    } else {
                      handleCreateBranch(data);
                    }
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">کد شعبه</label>
                    <input
                      name="code"
                      defaultValue={editingBranch.code}
                      required
                      dir="ltr"
                      pattern="[a-z0-9_-]{2,40}"
                      title="حروف لاتین کوچک، عدد، - یا _ (۲ تا ۴۰)"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">نام شعبه</label>
                    <input
                      name="name"
                      defaultValue={editingBranch.name}
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">نام آموزشگاه</label>
                    <input
                      name="academy_name"
                      defaultValue={editingBranch.academy_name ?? ''}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">آدرس</label>
                    <textarea
                      name="address"
                      defaultValue={editingBranch.address ?? ''}
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">تلفن</label>
                    <input
                      name="phone"
                      defaultValue={editingBranch.phone ?? ''}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">خط پیامک ارسال‌کننده</label>
                    <input
                      name="sms_sender_line"
                      dir="ltr"
                      inputMode="numeric"
                      placeholder="خالی = خط عمومی تنظیمات پیامک"
                      defaultValue={editingBranch.sms_sender_line ?? ''}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">نام مدیر</label>
                    <input
                      name="manager_name"
                      defaultValue={editingBranch.manager_name ?? ''}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="is_active"
                      id="is_active"
                      defaultChecked={editingBranch.is_active}
                      disabled={editingBranch.is_default}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <label htmlFor="is_active" className="text-sm text-slate-700">
                      فعال
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <button
                      type="button"
                      onClick={() => setEditingBranch(null)}
                      className="border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold"
                    >
                      لغو
                    </button>
                    <button
                      type="submit"
                      className="bg-sky-600 text-white rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1"
                    >
                      <Save className="w-4 h-4" />
                      ذخیره
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h2 className="text-lg font-bold mb-4">کاربران و شعبه</h2>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="نام کاربری"
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
            <button
              onClick={handleAddUser}
              className="bg-sky-600 text-white rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              اضافه کن
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 text-right">نام کاربری</th>
                  {branches.map(branch => (
                    <th key={branch.id} className="py-2 px-3 text-right">
                      {branch.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {userBranches.map(user => (
                  <tr key={user.username} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium">
                      <div dir="ltr" className="text-right">{user.username}</div>
                      {(user.full_name || user.role) && <div className="text-[11px] text-slate-400">{[user.full_name, user.role === 'admin' ? 'مدیر (همه شعب)' : user.role].filter(Boolean).join(' · ')}</div>}
                      {user.role !== 'admin' && user.branch_ids.length === 0 && <div className="text-[11px] text-amber-600">بدون شعبه: فقط شعبه پیش‌فرض</div>}
                    </td>
                    {branches.map(branch => (
                      <td key={branch.id} className="py-2 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={user.branch_ids.includes(branch.id)}
                          onChange={() => handleUserBranchToggle(user.username, branch.id)}
                          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'report' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h2 className="text-lg font-bold mb-4">گزارش شعب</h2>

          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">از تاریخ</label>
              <input
                type="text"
                value={reportFrom}
                onChange={e => setReportFrom(e.target.value)}
                placeholder="1405/08/01"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">تا تاریخ</label>
              <input
                type="text"
                value={reportTo}
                onChange={e => setReportTo(e.target.value)}
                placeholder="1405/08/31"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleGenerateReport}
                className="bg-sky-600 text-white rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1"
              >
                <FileText className="w-4 h-4" />
                تولید گزارش
              </button>
            </div>
          </div>

          {reportData && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-2 px-3 text-right">شعبه</th>
                    <th className="py-2 px-3 text-right">هنرجو</th>
                    <th className="py-2 px-3 text-right">ثبت‌نام</th>
                    <th className="py-2 px-3 text-right">شهریه</th>
                    <th className="py-2 px-3 text-right">دریافتی</th>
                    <th className="py-2 px-3 text-right">هزینه</th>
                    <th className="py-2 px-3 text-right">مانده</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.rows.map(row => (
                    <tr key={row.branch_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium">{row.name}</td>
                      <td className="py-2 px-3">{row.students.toLocaleString('fa-IR')}</td>
                      <td className="py-2 px-3">{row.enrollments.toLocaleString('fa-IR')}</td>
                      <td className="py-2 px-3">{row.tuition_total.toLocaleString('fa-IR')} تومان</td>
                      <td className="py-2 px-3">{row.paid_total.toLocaleString('fa-IR')} تومان</td>
                      <td className="py-2 px-3">{row.expenses_total.toLocaleString('fa-IR')} تومان</td>
                      <td className="py-2 px-3">{row.remaining_total.toLocaleString('fa-IR')} تومان</td>
                    </tr>
                  ))}
                  <tr className="font-bold bg-slate-50">
                    <td className="py-2 px-3">مجموع</td>
                    <td className="py-2 px-3">{reportData.totals.students.toLocaleString('fa-IR')}</td>
                    <td className="py-2 px-3">{reportData.totals.enrollments.toLocaleString('fa-IR')}</td>
                    <td className="py-2 px-3">{reportData.totals.tuition_total.toLocaleString('fa-IR')} تومان</td>
                    <td className="py-2 px-3">{reportData.totals.paid_total.toLocaleString('fa-IR')} تومان</td>
                    <td className="py-2 px-3">{reportData.totals.expenses_total.toLocaleString('fa-IR')} تومان</td>
                    <td className="py-2 px-3">{reportData.totals.remaining_total.toLocaleString('fa-IR')} تومان</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
