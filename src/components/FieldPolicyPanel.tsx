import React, { useEffect, useState, useMemo } from 'react'
import { Save, RotateCcw, RefreshCw, Check } from 'lucide-react'
import {
  getFieldPolicy,
  saveFieldPolicy,
  resetFieldPolicy,
  listFieldAccessLog,
  type FieldPolicyResponse,
  type FieldDef,
  type AccessLogRow,
  type PolicyRole,
  type Access,
  ROLE_LABEL,
  ACTION_LABEL,
} from '../api/fieldPolicy'

const ACCESS_OPTIONS: { value: Access; label: string; colorClass: string }[] = [
  { value: 'edit', label: 'ویرایش', colorClass: 'bg-emerald-100 text-emerald-700' },
  { value: 'view', label: 'مشاهده', colorClass: 'bg-sky-100 text-sky-700' },
  { value: 'masked', label: 'ماسک‌شده', colorClass: 'bg-amber-100 text-amber-700' },
  { value: 'hidden', label: 'پنهان', colorClass: 'bg-rose-100 text-rose-700' },
]

function FieldPolicyPanel() {
  const [data, setData] = useState<FieldPolicyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [policyState, setPolicyState] = useState<Record<string, Record<string, Access>>>(
    {}
  )
  const [auditEnabled, setAuditEnabled] = useState(false)
  const [dirty, setDirty] = useState(false)

  const [logs, setLogs] = useState<AccessLogRow[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)

  const [filters, setFilters] = useState<{
    username: string
    field: string
  }>({ username: '', field: '' })

  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    loadInitialData()
    loadLogs()
  }, [])

  useEffect(() => {
    if (data) checkDirty()
  }, [policyState, auditEnabled])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const res = await getFieldPolicy()
      setData(res)
      setPolicyState(JSON.parse(JSON.stringify(res.policy))) // deep copy to track changes
      setAuditEnabled(res.audit_enabled)
      setLoadError(null)
    } catch (err: any) {
      setLoadError(err?.message || 'خطا در بارگذاری تنظیمات.')
    } finally {
      setLoading(false)
    }
  }

  const checkDirty = () => {
    if (!data) return
    // Dirty = differs from what the server has saved (not from the defaults).
    const isPolicyDirty = data.roles.some((r) =>
      data.fields.some((f) => (policyState[r.id]?.[f.id] || 'hidden') !== (data.policy[r.id]?.[f.id] || 'hidden')))
    if (isPolicyDirty || auditEnabled !== data.audit_enabled) {
      setDirty(true)
    } else {
      setDirty(false)
    }
  }

  const handleSave = async () => {
    if (!data) return
    setSaving(true)
    try {
      await saveFieldPolicy({
        policy: policyState as Record<PolicyRole, Record<string, Access>>,
        audit_enabled: auditEnabled,
      })
      await loadInitialData() // Reset state to server state
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!data) return
    try {
      const res = await resetFieldPolicy()
      setData(res)
      setPolicyState(JSON.parse(JSON.stringify(res.policy)))
      setAuditEnabled(res.audit_enabled)
      setShowResetConfirm(false)
    } catch (err: any) {
      alert(err.message)
    }
  }

  const loadLogs = async () => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const res = await listFieldAccessLog({
        username: filters.username || undefined,
        field: filters.field || undefined,
        limit: 50,
      })
      setLogs(res)
    } catch (err: any) {
      setLogsError(err.message)
    } finally {
      setLogsLoading(false)
    }
  }

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFilters((prev) => ({ ...prev, [name]: value }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">در حال بارگذاری...</div>
    )
  }

  if (!data) {
    return <div className="text-rose-600 text-sm">{loadError || 'خطا در بارگذاری تنظیمات.'}</div>
  }

  // Helper to find label for field badge
  const getFieldLabel = (fieldId: string): string => {
    const field = data.fields.find((f) => f.id === fieldId)
    return field ? field.label : fieldId
  }

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(String(dateStr).includes('T') || String(dateStr).endsWith('Z') ? dateStr : String(dateStr).replace(' ', 'T'))
      if (Number.isNaN(date.getTime())) return dateStr
      return date.toLocaleString('fa-IR')
    } catch {
      return dateStr
    }
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">دسترسی ریزدانه به فیلدهای حساس</h1>
            <p className="mt-2 text-sm text-slate-600">
              مدیر سیستم همیشه دسترسی کامل دارد. این تنظیمات روی پاسخ‌های سرور اعمال می‌شود (نه فقط ظاهر).
            </p>
            <p className="mt-1 text-xs text-slate-500">
              «ویرایش» = دیدن و تغییر؛ «مشاهده» = فقط دیدن (در ثبت رکورد جدید هم مجاز است)؛ «ماسک‌شده» = بخشی از مقدار؛ «پنهان» = از پاسخ سرور حذف می‌شود.
              مدارک و عکس فقط «مشاهده» یا «پنهان» دارند (ماسک ندارند).
            </p>
          </div>
          {dirty && <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200">تغییرات ذخیره نشده</span>}
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="p-3 text-xs font-bold text-slate-500 text-right border-r border-slate-100 w-1/2">فیلد</th>
                {data.roles.map((role) => (
                  <th key={role.id} className="p-3 text-xs font-bold text-slate-500 border-r border-slate-100 text-right">
                    {role.label || ROLE_LABEL[role.id]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.fields.map((field) => (
                <tr key={field.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3 border-b border-slate-100 border-r border-slate-100">
                    <div className="font-bold text-slate-900 mb-1">{field.label}</div>
                    <div className="text-xs text-slate-500">{field.description}</div>
                  </td>
                  {data.roles.map((role) => {
                    const currentAccess = policyState[role.id]?.[field.id] || 'hidden'
                    const defaultAccess = data.defaults[role.id]?.[field.id] || 'hidden'
                    const isDifferent = currentAccess !== defaultAccess

                    return (
                      <td key={role.id} className="p-0 border-b border-slate-100 border-r border-slate-100">
                        <div className={`relative group ${isDifferent ? 'ring-2 ring-amber-300' : 'bg-white'}`}>
                          <select
                            value={currentAccess}
                            onChange={(e) => {
                              const nav = e.target.value as Access
                              setPolicyState((prev) => ({
                                ...prev,
                                [role.id]: {
                                  ...(prev[role.id] || {}),
                                  [field.id]: nav,
                                },
                              }))
                            }}
                            disabled={saving}
                            className={`w-full p-2.5 pr-8 appearance-none text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer bg-transparent ${isDifferent ? 'border-b-2 border-amber-400' : 'bg-transparent'}`}
                          >
                            {ACCESS_OPTIONS.map((opt) => (
                              <option
                                key={opt.value}
                                value={opt.value}
                                disabled={!field.maskable && opt.value === 'masked'}
                              >
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <span
                            className={`absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${ACCESS_OPTIONS.find((o) => o.value === currentAccess)?.colorClass || 'bg-transparent'}`}
                          />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-2 border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={saving}
          >
            <RotateCcw size={16} />
            بازگشت به پیش‌فرض
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-6 py-2 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {saving ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            ذخیره
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input
            id="audit"
            type="checkbox"
            checked={auditEnabled}
            onChange={(e) => setAuditEnabled(e.target.checked)}
            disabled={saving}
            className="w-4 h-4 text-sky-600 border-slate-300 rounded focus:ring-sky-500"
          />
          <label htmlFor="audit" className="text-sm text-slate-700 font-medium select-none cursor-pointer">
            ثبت گزارش دسترسی به فیلدهای حساس
          </label>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <RefreshCw size={18} />
          گزارش دسترسی
        </h3>

        <div className="flex flex-wrap gap-4 mb-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-500 mb-1">نام کاربری</label>
            <input
              name="username"
              value={filters.username}
              onChange={handleFilterChange}
              placeholder="نام کاربری (اختیاری)"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-500 mb-1">فیلد</label>
            <select
              name="field"
              value={filters.field}
              onChange={handleFilterChange}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            >
              <option value="">همه فیلدها</option>
              {data.fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <button
              onClick={loadLogs}
              disabled={logsLoading || saving}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg px-5 py-2 text-sm font-bold transition-colors disabled:opacity-50"
            >
              {logsLoading ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                'بارگذاری'
              )}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="p-2 text-xs font-bold text-slate-500 text-right whitespace-nowrap">زمان</th>
                <th className="p-2 text-xs font-bold text-slate-500 text-right whitespace-nowrap">کاربر</th>
                <th className="p-2 text-xs font-bold text-slate-500 text-right whitespace-nowrap">نقش</th>
                <th className="p-2 text-xs font-bold text-slate-500 text-right whitespace-nowrap">عملیات</th>
                <th className="p-2 text-xs font-bold text-slate-500 text-right whitespace-nowrap">مسیر</th>
                <th className="p-2 text-xs font-bold text-slate-500 text-right">فیلدها</th>
                <th className="p-2 text-xs font-bold text-slate-500 text-right whitespace-nowrap">تعداد رکورد</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && !logsLoading && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">داده‌ای یافت نشد</td>
                </tr>
              )}
              {logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="p-2 text-slate-600 whitespace-nowrap" dir="ltr">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="p-2">{log.username || '-'}</td>
                    <td className="p-2 text-slate-600">{(log.role && data.roles.find((r) => r.id === log.role)?.label) || (log.role === 'admin' ? 'مدیر' : log.role) || '-'}</td>
                    <td className="p-2">
                      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold ${ACTION_LABEL[log.action] === 'مشاهده' ? 'bg-emerald-100 text-emerald-700' : ACTION_LABEL[log.action] === 'ویرایش ردشده' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                        {ACTION_LABEL[log.action]}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-xs text-slate-500 whitespace-nowrap bg-slate-50 border border-slate-100 rounded px-2 py-1" dir="ltr">
                      {log.path}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {log.fields.length > 0 ? (
                          log.fields.map((fId) => (
                            <span key={fId} className="inline-block bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] px-1.5 py-0.5 rounded border border-slate-200">
                              {getFieldLabel(fId)}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 text-slate-600">
                      {new Intl.NumberFormat('fa-IR').format(log.records)} رکورد
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">بازگشت به پیش‌فرض</h3>
            <p className="text-sm text-slate-600 mb-6">
              مطمئن هستید که می‌خواهید همه تنظیمات دسترسی مجدد به حالت پیش‌فرض برگردانده شوند؟ این عمل غیرقابل بازگشت است.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-bold transition-colors"
              >
                انصراف
              </button>
              <button
                onClick={handleReset}
                className="bg-rose-600 hover:bg-rose-700 text-white rounded-lg px-4 py-2 text-sm font-bold transition-colors"
              >
                تایید بازگردانی
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FieldPolicyPanel
