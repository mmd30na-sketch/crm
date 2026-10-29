// Admin screen «اتوماسیون قاعده‌محور»: rules (event -> conditions -> actions), dry-run preview, run history.
// Every rule starts disabled and in dry-run mode; the server additionally gates everything behind CRM_AUTOMATION_ENABLED.
import { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Plus, Trash2, Edit, Play, History, ChevronDown, ChevronUp, AlertCircle, RefreshCw } from 'lucide-react';
import * as api from '../api/automation';

type EventField = {key: string; label: string; type: 'number'|'string'};
type EventInfo = {key: api.AutomationEvent; label: string; scheduled: boolean; fields: EventField[]};
type OpInfo = {key: api.CondOp; label: string};

const btnCls = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const ACTION_LABELS: Record<string, string> = { sms_template: 'پیامک الگو', sms_text: 'پیامک متنی', task: 'تسک', notify_admin: 'اعلان مدیر', note: 'یادداشت' };

export default function AutomationRulesPanel() {
  const [meta, setMeta] = useState<api.AutomationMeta | null>(null);
  const [rules, setRules] = useState<api.AutomationRule[]>([]);
  const [runs, setRuns] = useState<api.AutomationRun[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<api.RuleDraft | null>(null);
  const [previewResult, setPreviewResult] = useState<api.PreviewResult | null>(null);
  const [runOffset, setRunOffset] = useState(0);
  const [runRuleId, setRunRuleId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const eventInfo = useMemo(() => meta?.events || [], [meta]);
  const opInfo = useMemo(() => meta?.ops || [], [meta]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadRuns(offset = runOffset, ruleId = runRuleId) {
    try {
      const res = await api.listRuns({limit: 50, offset, rule_id: ruleId ?? undefined});
      setRuns(res.rows);
      setTotalRuns(res.total);
      setRunOffset(offset);
      setRunRuleId(ruleId);
    } catch (err) {
      handleError(err);
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      const [metaRes, rulesRes] = await Promise.all([api.getMeta(), api.listRules()]);
      setMeta(metaRes);
      setRules(rulesRes.rules);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری داده‌ها');
    } finally {
      setLoading(false);
    }
  }

  function openEditor(draft: api.RuleDraft) {
    // Deep copy: the editor mutates nested condition/action objects.
    setEditingRule(JSON.parse(JSON.stringify(draft)));
    setPreviewResult(null);
  }

  function handleError(err: unknown) {
    setError(err instanceof Error ? err.message : 'خطا نامشخص');
    setTimeout(() => setError(null), 5000);
  }

  function handleNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }

  function getEventFields(event: api.AutomationEvent): EventField[] {
    return eventInfo.find(e => e.key === event)?.fields || [];
  }

  function getEventLabel(event: api.AutomationEvent): string {
    return eventInfo.find(e => e.key === event)?.label || event;
  }

  function getOpLabel(op: api.CondOp): string {
    return opInfo.find(o => o.key === op)?.label || op;
  }

  function getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      running: 'در حال اجرا',
      done: 'انجام شد',
      partial: 'ناقص',
      failed: 'ناموفق',
      skipped: 'رد شد',
      rate_limited: 'محدودیت نرخ',
      dry_run: 'آزمایشی'
    };
    return labels[status] || status;
  }

  function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      running: 'text-blue-600',
      done: 'text-green-600',
      partial: 'text-yellow-600',
      failed: 'text-red-600',
      skipped: 'text-gray-600',
      rate_limited: 'text-yellow-600',
      dry_run: 'text-yellow-600'
    };
    return colors[status] || 'text-gray-600';
  }

  function formatNumber(n: number): string {
    return n.toLocaleString('fa-IR');
  }

  function formatDate(d: string): string {
    return new Date(d).toLocaleString('fa-IR');
  }

  function renderStatusBanner() {
    if (!meta) return null;

    return (
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-lg mb-6">
        <div className="flex items-start gap-3">
          {!meta.enabled && (
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
          )}
          <div className="flex-1">
            {!meta.enabled && (
              <p className="text-amber-800 font-medium">
                اتوماسیون در سطح سرور خاموش است (CRM_AUTOMATION_ENABLED). هیچ قاعده‌ای اجرا نمی‌شود.
              </p>
            )}
            {meta.test_mobile_env && (
              <p className="text-amber-800 mt-2">
                شماره تست سرور: {meta.test_mobile_masked}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {meta.telegram_configured && (
                <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                  تلگرام پیکربندی شده
                </span>
              )}
              {meta.rubika_configured && (
                <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">
                  روبیکا پیکربندی شده
                </span>
              )}
              <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">
                ساعت روزانه: {meta.daily_hour}:00
              </span>
              <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">
                حداکثر پیامک روزانه: {formatNumber(meta.max_sms_per_day)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderRulesTable() {
    if (!rules.length) {
      return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">هنوز قاعده‌ای ساخته نشده است.</div>;
    }
    return (
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">نام</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">رویداد</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">وضعیت</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">اقدامات</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">عملیات</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {rules.map(rule => (
              <tr key={rule.id}>
                <td className="px-4 py-3 text-sm text-slate-900">
                  <div className="font-medium">{rule.name}</div>
                  {rule.description && (
                    <div className="text-xs text-slate-500 mt-1">{rule.description}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">
                  {getEventLabel(rule.event)}
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap gap-1">
                    <span className={`px-2 py-1 rounded-full text-xs ${rule.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {rule.enabled ? 'فعال' : 'غیرفعال'}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs ${rule.dry_run ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {rule.dry_run ? 'آزمایشی' : 'واقعی'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">
                  {rule.actions.map(a => ACTION_LABELS[a.type] || a.type).join('، ')}
                </td>
                <td className="px-4 py-3 text-sm font-medium">
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => openEditor(rule)} className={btnCls}>
                      <Edit className="h-3.5 w-3.5" /> ویرایش
                    </button>
                    <button
                      disabled={busyId === rule.id}
                      onClick={async () => {
                        setBusyId(rule.id);
                        try {
                          const updated = await api.toggleRule(rule.id, {enabled: !rule.enabled});
                          setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
                          handleNotice(`قاعده ${updated.enabled ? 'فعال' : 'غیرفعال'} شد`);
                        } catch (err) {
                          handleError(err);
                        } finally { setBusyId(null); }
                      }}
                      className={btnCls}
                    >
                      {rule.enabled ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {rule.enabled ? 'غیرفعال کن' : 'فعال کن'}
                    </button>
                    <button
                      disabled={busyId === rule.id}
                      onClick={async () => {
                        // Leaving dry-run is the dangerous direction: ask first.
                        if (rule.dry_run && !window.confirm('با خروج از حالت آزمایشی، این قاعده (در صورت روشن بودن اتوماسیون در سرور) پیامک و اعلان واقعی ارسال می‌کند. اگر شماره تست تنظیم نشده باشد، پیامک به شماره واقعی کارآموزان می‌رود. ادامه می‌دهید؟')) return;
                        setBusyId(rule.id);
                        try {
                          const updated = await api.toggleRule(rule.id, {dry_run: !rule.dry_run});
                          setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
                          handleNotice(`حالت قاعده به ${updated.dry_run ? 'آزمایشی' : 'واقعی'} تغییر یافت`);
                        } catch (err) {
                          handleError(err);
                        } finally { setBusyId(null); }
                      }}
                      className={rule.dry_run ? btnCls : `${btnCls} border-amber-300 text-amber-700`}
                    >
                      {rule.dry_run ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {rule.dry_run ? 'تبدیل به واقعی' : 'بازگشت به آزمایشی'}
                    </button>
                    {eventInfo.find(e => e.key === rule.event)?.scheduled && (
                      <button
                        disabled={busyId === rule.id}
                        onClick={async () => {
                          const live = !!meta?.enabled && !rule.dry_run;
                          let confirm: string | undefined;
                          if (live) {
                            const typed = window.prompt('این قاعده در حالت واقعی است و ممکن است پیامک واقعی ارسال کند. برای اجرا عبارت «اجرا» را تایپ کنید.');
                            if ((typed || '').trim() !== 'اجرا') return;
                            confirm = 'اجرا';
                          }
                          setBusyId(rule.id);
                          try {
                            const r = await api.runNow(rule.id, confirm);
                            handleNotice(`اجرا شد (${r.live ? 'واقعی' : 'آزمایشی'}): ${formatNumber(r.matched)} مورد مطابق، ${formatNumber(r.executed)} اجرا، ${formatNumber(r.dry_runs)} آزمایشی، ${formatNumber(r.duplicates)} تکراری، ${formatNumber(r.rate_limited)} محدودشده`);
                            await loadRuns(0, rule.id);
                          } catch (err) {
                            handleError(err);
                          } finally { setBusyId(null); }
                        }}
                        className={btnCls}
                      >
                        <Play className="h-3.5 w-3.5" /> اجرای اکنون
                      </button>
                    )}
                    <button onClick={() => loadRuns(0, rule.id)} className={btnCls}>
                      <History className="h-3.5 w-3.5" /> سوابق
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`قاعده «${rule.name}» حذف شود؟ سوابق اجرای آن باقی می‌ماند.`)) return;
                        try {
                          await api.deleteRule(rule.id);
                          setRules(prev => prev.filter(r => r.id !== rule.id));
                          handleNotice('قاعده حذف شد');
                        } catch (err) {
                          handleError(err);
                        }
                      }}
                      className={`${btnCls} border-rose-200 text-rose-700`}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderRuleEditor() {
    if (!editingRule) return null;

    const eventFields = getEventFields(editingRule.event);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-6">
              {editingRule.id ? 'ویرایش قاعده' : 'قاعده جدید'}
            </h2>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">نام قاعده</label>
                <input
                  type="text"
                  value={editingRule.name}
                  onChange={e => setEditingRule({...editingRule, name: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">توضیحات (اختیاری)</label>
                <textarea
                  value={editingRule.description}
                  onChange={e => setEditingRule({...editingRule, description: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">رویداد</label>
                <select
                  value={editingRule.event}
                  onChange={e => setEditingRule({
                    ...editingRule,
                    event: e.target.value as api.AutomationEvent,
                    conditions: {mode: 'all', items: []}
                  })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                >
                  {eventInfo.map(event => (
                    <option key={event.key} value={event.key}>{event.label}</option>
                  ))}
                </select>
              </div>

              {/* Event-specific parameters */}
              {editingRule.event === 'installment_due' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">روزهای قبل از سررسید</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={editingRule.params.days_before || 0}
                    onChange={e => setEditingRule({
                      ...editingRule,
                      params: {...editingRule.params, days_before: parseInt(e.target.value) || 0}
                    })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
              )}

              {editingRule.event === 'debt_above_threshold' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">حداقل بدهی (تومان)</label>
                  <input
                    type="number"
                    min="1"
                    value={editingRule.params.threshold || ''}
                    onChange={e => setEditingRule({
                      ...editingRule,
                      params: {...editingRule.params, threshold: parseInt(e.target.value) || undefined}
                    })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
              )}

              {(eventInfo.find(e => e.key === editingRule.event)?.scheduled || false) && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">تکرار هر چند روز</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={editingRule.params.repeat_days || 1}
                    onChange={e => setEditingRule({
                      ...editingRule,
                      params: {...editingRule.params, repeat_days: parseInt(e.target.value) || 1}
                    })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
              )}

              {/* Conditions builder */}
              <div className="border border-slate-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-medium text-slate-700">شرایط</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500">حالت:</span>
                    <select
                      value={editingRule.conditions.mode}
                      onChange={e => setEditingRule({
                        ...editingRule,
                        conditions: {...editingRule.conditions, mode: e.target.value as 'all' | 'any'}
                      })}
                      className="px-2 py-1 border border-slate-300 rounded-md text-sm"
                    >
                      <option value="all">همه شرط‌ها (و)</option>
                      <option value="any">حداقل یکی (یا)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-3">
                  {editingRule.conditions.items.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      {'field' in item ? (
                        <>
                          <select
                            value={item.field}
                            onChange={e => {
                              const newItems = [...editingRule.conditions.items];
                              (newItems[index] as api.Condition).field = e.target.value;
                              setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                            }}
                            className="flex-1 px-2 py-1 border border-slate-300 rounded-md text-sm"
                          >
                            {eventFields.map(field => (
                              <option key={field.key} value={field.key}>{field.label}</option>
                            ))}
                          </select>

                          <select
                            value={item.op}
                            onChange={e => {
                              const newItems = [...editingRule.conditions.items];
                              (newItems[index] as api.Condition).op = e.target.value as api.CondOp;
                              setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                            }}
                            className="flex-1 px-2 py-1 border border-slate-300 rounded-md text-sm"
                          >
                            {opInfo.map(op => (
                              <option key={op.key} value={op.key}>{op.label}</option>
                            ))}
                          </select>

                          <input
                            type={item.op !== 'in' && eventFields.find(f => f.key === item.field)?.type === 'number' ? 'number' : 'text'}
                            value={Array.isArray(item.value) ? item.value.join(',') : String(item.value ?? '')}
                            onChange={e => {
                              const newItems = [...editingRule.conditions.items];
                              (newItems[index] as api.Condition).value = e.target.value;
                              setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                            }}
                            className="flex-1 px-2 py-1 border border-slate-300 rounded-md text-sm"
                          />
                        </>
                      ) : (
                        <div className="flex-1 border border-slate-200 rounded-md p-2">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium text-slate-700">
                              گروه {item.mode === 'all' ? 'همه' : 'حداقل یکی'}
                            </span>
                            <select
                              value={item.mode}
                              onChange={e => {
                                const newItems = [...editingRule.conditions.items];
                                (newItems[index] as api.ConditionGroup).mode = e.target.value as 'all' | 'any';
                                setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                              }}
                              className="px-2 py-1 border border-slate-300 rounded-md text-sm"
                            >
                              <option value="all">همه (و)</option>
                              <option value="any">حداقل یکی (یا)</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            {item.items.map((subItem, subIndex) => (
                              <div key={subIndex} className="flex items-center gap-2">
                                {'field' in subItem ? (
                                  <>
                                    <select
                                      value={subItem.field}
                                      onChange={e => {
                                        const newItems = [...editingRule.conditions.items];
                                        const newSubItems = [...(newItems[index] as api.ConditionGroup).items];
                                        (newSubItems[subIndex] as api.Condition).field = e.target.value;
                                        (newItems[index] as api.ConditionGroup).items = newSubItems;
                                        setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                                      }}
                                      className="flex-1 px-2 py-1 border border-slate-300 rounded-md text-sm"
                                    >
                                      {eventFields.map(field => (
                                        <option key={field.key} value={field.key}>{field.label}</option>
                                      ))}
                                    </select>

                                    <select
                                      value={subItem.op}
                                      onChange={e => {
                                        const newItems = [...editingRule.conditions.items];
                                        const newSubItems = [...(newItems[index] as api.ConditionGroup).items];
                                        (newSubItems[subIndex] as api.Condition).op = e.target.value as api.CondOp;
                                        (newItems[index] as api.ConditionGroup).items = newSubItems;
                                        setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                                      }}
                                      className="flex-1 px-2 py-1 border border-slate-300 rounded-md text-sm"
                                    >
                                      {opInfo.map(op => (
                                        <option key={op.key} value={op.key}>{op.label}</option>
                                      ))}
                                    </select>

                                    <input
                                      type={subItem.op !== 'in' && eventFields.find(f => f.key === subItem.field)?.type === 'number' ? 'number' : 'text'}
                                      value={Array.isArray(subItem.value) ? subItem.value.join(',') : String(subItem.value ?? '')}
                                      onChange={e => {
                                        const newItems = [...editingRule.conditions.items];
                                        const newSubItems = [...(newItems[index] as api.ConditionGroup).items];
                                        (newSubItems[subIndex] as api.Condition).value = e.target.value;
                                        (newItems[index] as api.ConditionGroup).items = newSubItems;
                                        setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                                      }}
                                      className="flex-1 px-2 py-1 border border-slate-300 rounded-md text-sm"
                                    />
                                  </>
                                ) : null}
                                <button
                                  onClick={() => {
                                    const newItems = [...editingRule.conditions.items];
                                    const newSubItems = [...(newItems[index] as api.ConditionGroup).items];
                                    newSubItems.splice(subIndex, 1);
                                    (newItems[index] as api.ConditionGroup).items = newSubItems;
                                    setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                                  }}
                                  className="text-rose-600 hover:text-rose-900"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => {
                              const newItems = [...editingRule.conditions.items];
                              const newSubItems = [...(newItems[index] as api.ConditionGroup).items];
                              newSubItems.push({
                                field: eventFields[0]?.key || '',
                                op: 'eq',
                                value: ''
                              });
                              (newItems[index] as api.ConditionGroup).items = newSubItems;
                              setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                            }}
                            className="mt-2 text-sky-600 hover:text-sky-900 text-sm flex items-center gap-1"
                          >
                            <Plus className="h-4 w-4" /> افزودن شرط
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          const newItems = [...editingRule.conditions.items];
                          newItems.splice(index, 1);
                          setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                        }}
                        className="text-rose-600 hover:text-rose-900"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => {
                      const newItems = [...editingRule.conditions.items];
                      newItems.push({
                        field: eventFields[0]?.key || '',
                        op: 'eq',
                        value: ''
                      });
                      setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                    }}
                    className="text-sky-600 hover:text-sky-900 text-sm flex items-center gap-1"
                  >
                    <Plus className="h-4 w-4" /> افزودن شرط
                  </button>
                  <button
                    onClick={() => {
                      const newItems = [...editingRule.conditions.items];
                      newItems.push({
                        mode: 'all',
                        items: []
                      });
                      setEditingRule({...editingRule, conditions: {...editingRule.conditions, items: newItems}});
                    }}
                    className="text-sky-600 hover:text-sky-900 text-sm flex items-center gap-1"
                  >
                    <Plus className="h-4 w-4" /> افزودن گروه
                  </button>
                </div>
              </div>

              {/* Actions builder */}
              <div className="border border-slate-200 rounded-lg p-4">
                <h3 className="text-sm font-medium text-slate-700 mb-3">اقدامات</h3>

                <div className="space-y-4">
                  {editingRule.actions.map((action, index) => (
                    <div key={index} className="border border-slate-200 rounded-md p-3">
                      <div className="flex justify-between items-center mb-2">
                        <select
                          value={action.type}
                          onChange={e => {
                            const newActions = [...editingRule.actions];
                            const newAction = {type: e.target.value as api.AutomationAction['type']};
                            if (e.target.value === 'sms_template') {
                              (newAction as api.AutomationAction & {type: 'sms_template'}).template_key = '';
                            } else if (e.target.value === 'sms_text') {
                              (newAction as api.AutomationAction & {type: 'sms_text'}).text = '';
                            } else if (e.target.value === 'task') {
                              (newAction as api.AutomationAction & {type: 'task'}).title = '';
                            } else if (e.target.value === 'notify_admin') {
                              (newAction as api.AutomationAction & {type: 'notify_admin'}).channel = 'telegram';
                              (newAction as api.AutomationAction & {type: 'notify_admin'}).text = '';
                            } else if (e.target.value === 'note') {
                              (newAction as api.AutomationAction & {type: 'note'}).text = '';
                            }
                            newActions[index] = newAction as api.AutomationAction;
                            setEditingRule({...editingRule, actions: newActions});
                          }}
                          className="px-2 py-1 border border-slate-300 rounded-md text-sm"
                        >
                          <option value="sms_template">پیامک از قالب</option>
                          <option value="sms_text">پیامک متنی</option>
                          <option value="task">ایجاد کار</option>
                          <option value="notify_admin">اعلان مدیر</option>
                          <option value="note">یادداشت</option>
                        </select>
                        <button
                          onClick={() => {
                            const newActions = [...editingRule.actions];
                            newActions.splice(index, 1);
                            setEditingRule({...editingRule, actions: newActions});
                          }}
                          className="text-rose-600 hover:text-rose-900"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {action.type === 'sms_template' && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">کد قالب</label>
                          <input
                            type="text"
                            value={action.template_key}
                            onChange={e => {
                              const newActions = [...editingRule.actions];
                              (newActions[index] as api.AutomationAction & {type: 'sms_template'}).template_key = e.target.value;
                              setEditingRule({...editingRule, actions: newActions});
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                          />
                        </div>
                      )}

                      {action.type === 'sms_text' && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">متن پیامک</label>
                          <textarea
                            value={action.text}
                            onChange={e => {
                              const newActions = [...editingRule.actions];
                              (newActions[index] as api.AutomationAction & {type: 'sms_text'}).text = e.target.value;
                              setEditingRule({...editingRule, actions: newActions});
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                            rows={3}
                          />
                          <div className="mt-2 flex flex-wrap gap-1">
                            {['{name}', '{family}', '{course}', '{amount}', '{debt}', '{date}', '{due_date}', '{days_overdue}', '{tracking_code}', '{reason}'].map(placeholder => (
                              <button
                                key={placeholder}
                                onClick={() => {
                                  const newActions = [...editingRule.actions];
                                  (newActions[index] as api.AutomationAction & {type: 'sms_text'}).text += placeholder;
                                  setEditingRule({...editingRule, actions: newActions});
                                }}
                                className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded-full hover:bg-slate-200"
                              >
                                {placeholder}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {action.type === 'task' && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">عنوان کار</label>
                            <input
                              type="text"
                              value={action.title}
                              onChange={e => {
                                const newActions = [...editingRule.actions];
                                (newActions[index] as api.AutomationAction & {type: 'task'}).title = e.target.value;
                                setEditingRule({...editingRule, actions: newActions});
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">توضیحات (اختیاری)</label>
                            <textarea
                              value={action.description || ''}
                              onChange={e => {
                                const newActions = [...editingRule.actions];
                                (newActions[index] as api.AutomationAction & {type: 'task'}).description = e.target.value;
                                setEditingRule({...editingRule, actions: newActions});
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                              rows={2}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">مسئول (اختیاری)</label>
                            <input
                              type="text"
                              value={action.assignee || ''}
                              onChange={e => {
                                const newActions = [...editingRule.actions];
                                (newActions[index] as api.AutomationAction & {type: 'task'}).assignee = e.target.value;
                                setEditingRule({...editingRule, actions: newActions});
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">تاریخ سررسید (روزهای بعد)</label>
                            <input
                              type="number"
                              min="0"
                              value={action.due_in_days || ''}
                              onChange={e => {
                                const newActions = [...editingRule.actions];
                                (newActions[index] as api.AutomationAction & {type: 'task'}).due_in_days = parseInt(e.target.value) || undefined;
                                setEditingRule({...editingRule, actions: newActions});
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">اولویت</label>
                            <select
                              value={action.priority || 'normal'}
                              onChange={e => {
                                const newActions = [...editingRule.actions];
                                (newActions[index] as api.AutomationAction & {type: 'task'}).priority = e.target.value as 'low' | 'normal' | 'high';
                                setEditingRule({...editingRule, actions: newActions});
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                            >
                              <option value="low">کم</option>
                              <option value="normal">معمولی</option>
                              <option value="high">زیاد</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {action.type === 'notify_admin' && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">کانال</label>
                            <select
                              value={action.channel}
                              onChange={e => {
                                const newActions = [...editingRule.actions];
                                (newActions[index] as api.AutomationAction & {type: 'notify_admin'}).channel = e.target.value as 'telegram' | 'rubika';
                                setEditingRule({...editingRule, actions: newActions});
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                            >
                              <option value="telegram">تلگرام</option>
                              <option value="rubika">روبیکا</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">متن</label>
                            <textarea
                              value={action.text}
                              onChange={e => {
                                const newActions = [...editingRule.actions];
                                (newActions[index] as api.AutomationAction & {type: 'notify_admin'}).text = e.target.value;
                                setEditingRule({...editingRule, actions: newActions});
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                              rows={3}
                            />
                          </div>
                        </div>
                      )}

                      {action.type === 'note' && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">متن یادداشت</label>
                          <textarea
                            value={action.text}
                            onChange={e => {
                              const newActions = [...editingRule.actions];
                              (newActions[index] as api.AutomationAction & {type: 'note'}).text = e.target.value;
                              setEditingRule({...editingRule, actions: newActions});
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                            rows={3}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    const newActions = [...editingRule.actions];
                    newActions.push({type: 'sms_template', template_key: ''});
                    setEditingRule({...editingRule, actions: newActions});
                  }}
                  className="mt-3 text-sky-600 hover:text-sky-900 text-sm flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" /> افزودن اقدام
                </button>
              </div>

              {/* Options */}
              <div className="border border-slate-200 rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingRule.dry_run}
                    onChange={e => setEditingRule({...editingRule, dry_run: e.target.checked})}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <label className="text-sm text-slate-700">حالت آزمایشی: هیچ پیامی ارسال نمی‌شود، فقط ثبت می‌شود</label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">شماره تست (همه پیامک‌ها به این شماره می‌رود)</label>
                  <input
                    type="text"
                    value={editingRule.test_mobile}
                    onChange={e => setEditingRule({...editingRule, test_mobile: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                    placeholder="خالی برای غیرفعال کردن"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">حداکثر پیامک در ساعت</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={editingRule.max_per_hour}
                    onChange={e => setEditingRule({...editingRule, max_per_hour: parseInt(e.target.value) || 30})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Preview */}
              {previewResult && (
                <div className="border border-slate-200 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-slate-700 mb-3">پیش‌نمایش</h3>

                  {previewResult.warnings.length > 0 && (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-md mb-4">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                        <div>
                          <h4 className="font-medium text-amber-800">هشدارها</h4>
                          <ul className="list-disc list-inside text-amber-700 text-sm mt-1">
                            {previewResult.warnings.map((warning, i) => (
                              <li key={i}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  <p className="text-sm text-slate-700 mb-3">
                    {formatNumber(previewResult.matched)} مورد از {formatNumber(previewResult.total_checked)} بررسی‌شده مطابق است
                  </p>

                  {previewResult.items.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">نام</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">شماره موبایل</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">اقدامات</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                          {previewResult.items.map((item, i) => (
                            <tr key={i}>
                              <td className="px-4 py-2 text-sm text-slate-900">{item.name_masked}</td>
                              <td className="px-4 py-2 text-sm text-slate-500">{item.mobile_masked}</td>
                              <td className="px-4 py-2 text-sm">
                                <ul className="space-y-1">
                                  {item.actions.map((action, j) => (
                                    <li key={j} className="text-slate-700">
                                      {action.preview}
                                      {action.to_masked && (
                                        <span className="text-slate-500"> به {action.to_masked}</span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => { setEditingRule(null); setPreviewResult(null); }}
                className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                انصراف
              </button>
              <button
                onClick={async () => {
                  try {
                    const result = await api.previewRule(editingRule);
                    setPreviewResult(result);
                  } catch (err) {
                    handleError(err);
                  }
                }}
                className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                پیش‌نمایش
              </button>
              <button
                onClick={async () => {
                  try {
                    if (editingRule.id) {
                      await api.updateRule(editingRule.id, editingRule);
                    } else {
                      await api.createRule(editingRule);
                    }
                    setEditingRule(null);
                    setPreviewResult(null);
                    handleNotice('قاعده ذخیره شد');
                    loadData();
                  } catch (err) {
                    handleError(err);
                  }
                }}
                className="px-4 py-2 bg-sky-600 border border-transparent rounded-md text-sm font-medium text-white hover:bg-sky-700"
              >
                ذخیره
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderRunsTable() {
    return (
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-slate-900">
            سوابق اجرا{runRuleId ? ` — ${rules.find(r => r.id === runRuleId)?.name || `قاعده #${runRuleId}`}` : ''}
            <span className="mr-2 text-xs font-normal text-slate-500">({formatNumber(totalRuns)} مورد)</span>
          </h3>
          <div className="flex gap-2">
            {runRuleId && (
              <button onClick={() => loadRuns(0, null)} className={btnCls}>همه قاعده‌ها</button>
            )}
            <button onClick={() => loadRuns()} className={btnCls}>
              <RefreshCw className="h-3.5 w-3.5" /> تازه‌سازی
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">زمان</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">قاعده</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">رویداد</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">حالت</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">وضعیت</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">هدف</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">خلاصه</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {!runs.length && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">سابقه‌ای ثبت نشده است.</td></tr>
              )}
              {runs.map(run => (
                <tr key={run.id}>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {formatDate(run.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {run.rule_name}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {getEventLabel(run.event as api.AutomationEvent)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs ${run.mode === 'dry' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {run.mode === 'dry' ? 'آزمایشی' : 'واقعی'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(run.status)}`}>
                      {getStatusLabel(run.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {run.target_masked || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {run.summary || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalRuns > 50 && (
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => loadRuns(Math.max(0, runOffset - 50))}
              disabled={runOffset === 0}
              className="px-3 py-1 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => loadRuns(runOffset + 50)}
              disabled={runOffset + 50 >= totalRuns}
              className="px-3 py-1 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">اتوماسیون قاعده‌محور</h1>

      {error && (
        <div className="bg-rose-50 border-l-4 border-rose-500 p-4 rounded-lg mb-6">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-rose-600" />
            </div>
            <p className="text-rose-800">{error}</p>
          </div>
        </div>
      )}

      {notice && (
        <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-lg mb-6">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="text-emerald-800">{notice}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
        </div>
      ) : (
        <>
          {renderStatusBanner()}

          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-900">قواعد اتوماسیون</h2>
            <button
              onClick={() => openEditor({
                name: '',
                description: '',
                event: 'enrollment_created',
                conditions: {mode: 'all', items: []},
                actions: [],
                enabled: false,
                dry_run: true,
                test_mobile: '',
                max_per_hour: 30,
                params: {}
              })}
              className="px-4 py-2 bg-sky-600 border border-transparent rounded-md text-sm font-medium text-white hover:bg-sky-700 flex items-center gap-1"
            >
              <Plus className="h-4 w-4" /> قاعده جدید
            </button>
          </div>

          {renderRulesTable()}

          {renderRunsTable()}

          {renderRuleEditor()}
        </>
      )}
    </div>
  );
}
