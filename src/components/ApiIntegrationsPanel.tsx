import { useState, useEffect } from 'react';
import {
  Copy, KeyRound, Webhook, Check, X, AlertTriangle, RefreshCw, Trash2, Send, EyeOff, Eye
} from 'lucide-react';
import {
  listApiKeys, createApiKey, revokeApiKey,
  listWebhooks, createWebhook, setWebhookActive, rotateWebhookSecret, deleteWebhook, testWebhook,
  listDeliveries, WEBHOOK_EVENTS
} from '../api/publicApi';

type ApiKey = Awaited<ReturnType<typeof listApiKeys>>[0];
type WebhookSub = Awaited<ReturnType<typeof listWebhooks>>[0];
type Delivery = Awaited<ReturnType<typeof listDeliveries>>[0];

export default function ApiIntegrationsPanel() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookSub[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState<{ id: number; key: string } | null>(null);
  const [showNewSecret, setShowNewSecret] = useState<{ id: number; secret: string } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [keys, hooks, logs] = await Promise.all([
        listApiKeys(),
        listWebhooks(),
        listDeliveries()
      ]);
      setApiKeys(keys);
      setWebhooks(hooks);
      setDeliveries(logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری داده‌ها');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateApiKey(formData: FormData) {
    const name = formData.get('name') as string;
    const scopes = [
      formData.has('read') ? 'read' : '',
      formData.has('write') ? 'write' : ''
    ].filter(Boolean);
    const rate_limit_per_min = parseInt(formData.get('rate_limit') as string) || 60;

    if (!name || scopes.length === 0) {
      setError('نام و حداقل یک مجوز الزامی است');
      return;
    }

    try {
      const { id, key } = await createApiKey({ name, scopes, rate_limit_per_min });
      setShowNewKey({ id, key });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد کلید API');
    }
  }

  async function handleRevokeApiKey(id: number) {
    if (!window.confirm('آیا مطمئن هستید که می‌خواهید این کلید را باطل کنید؟')) return;

    try {
      await revokeApiKey(id);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در باطل کردن کلید');
    }
  }

  async function handleCreateWebhook(formData: FormData) {
    const url = formData.get('url') as string;
    const events = WEBHOOK_EVENTS
      .filter(e => formData.has(`event_${e.id}`))
      .map(e => e.id);
    const description = formData.get('description') as string;

    if (!url || !url.startsWith('https://') || events.length === 0) {
      setError('آدرس HTTPS معتبر و حداقل یک رویداد الزامی است');
      return;
    }

    try {
      const { id, secret } = await createWebhook({ url, events, description });
      setShowNewSecret({ id, secret });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد وب‌هوک');
    }
  }

  async function handleToggleWebhook(id: number, active: boolean) {
    try {
      await setWebhookActive(id, active);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تغییر وضعیت وب‌هوک');
    }
  }

  async function handleTestWebhook(id: number) {
    try {
      const result = await testWebhook(id);
      if (result.ok) {
        window.alert(`ارسال آزمایشی موفق بود (کد ${result.status ?? 200})`);
      } else {
        setError(`تست ناموفق: ${result.error || `کد ${result.status}`}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تست وب‌هوک');
    }
  }

  async function handleRotateSecret(id: number) {
    try {
      const { secret } = await rotateWebhookSecret(id);
      setShowNewSecret({ id, secret });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در چرخش کلید امضا');
    }
  }

  async function handleDeleteWebhook(id: number) {
    if (!window.confirm('آیا مطمئن هستید که می‌خواهید این وب‌هوک را حذف کنید؟')) return;

    try {
      await deleteWebhook(id);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در حذف وب‌هوک');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {
      setError('خطا در کپی به کلیپ‌بورد');
    });
  }

  return (
    <div dir="rtl" className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="mr-auto text-red-500">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* API Keys Section */}
      <div className="rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="p-6 border-b flex justify-between items-center">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            کلیدهای API
          </h2>
          <a href="/api/v1/docs" target="_blank" className="text-sm text-blue-500 hover:underline">
            مستندات API
          </a>
        </div>

        <div className="p-6 space-y-4">
          {apiKeys.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-sm font-medium">نام</th>
                    <th className="p-3 text-sm font-medium">پیشوند</th>
                    <th className="p-3 text-sm font-medium">مجوزها</th>
                    <th className="p-3 text-sm font-medium">محدودیت درخواست</th>
                    <th className="p-3 text-sm font-medium">آخرین استفاده</th>
                    <th className="p-3 text-sm font-medium">وضعیت</th>
                    <th className="p-3 text-sm font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map(key => (
                    <tr key={key.id} className="border-b last:border-b-0">
                      <td className="p-3">{key.name}</td>
                      <td className="p-3">{key.prefix}…</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {key.scopes.includes('read') && (
                            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                              خواندن
                            </span>
                          )}
                          {key.scopes.includes('write') && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                              نوشتن
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">{key.rate_limit_per_min} درخواست/دقیقه</td>
                      <td className="p-3">
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleString('fa-IR') : '—'}
                      </td>
                      <td className="p-3">
                        {key.revoked_at ? (
                          <span className="text-red-500">باطل‌شده</span>
                        ) : (
                          <span className="text-green-500">فعال</span>
                        )}
                      </td>
                      <td className="p-3">
                        {!key.revoked_at && (
                          <button
                            onClick={() => handleRevokeApiKey(key.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            باطل کردن
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">هیچ کلید API ای یافت نشد</p>
          )}

          <form
            onSubmit={e => {
              e.preventDefault();
              handleCreateApiKey(new FormData(e.currentTarget));
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">نام</label>
                <input
                  name="name"
                  required
                  className="w-full p-2 border rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                  placeholder="نام کلید API"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">مجوزها</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="read" defaultChecked />
                    <span>خواندن</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="write" />
                    <span>نوشتن</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">محدودیت درخواست (در دقیقه)</label>
                <input
                  name="rate_limit"
                  type="number"
                  min="1"
                  defaultValue="60"
                  className="w-full p-2 border rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
            >
              ایجاد کلید
            </button>
          </form>

          {showNewKey && (
            <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-200">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">کلید جدید ایجاد شد</h3>
                  <p className="text-sm text-yellow-700 mt-1">
                    این کلید فقط یک‌بار نمایش داده می‌شود. لطفاً آن را کپی کنید.
                  </p>
                </div>
                <button onClick={() => setShowNewKey(null)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-md border flex items-center gap-2 overflow-x-auto">
                <code dir="ltr" className="text-sm break-all select-all">{showNewKey.key}</code>
                <button
                  onClick={() => copyToClipboard(showNewKey.key)}
                  className="mr-auto text-blue-500 hover:text-blue-700"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Webhooks Section */}
      <div className="rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="p-6 border-b flex justify-between items-center">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            وب‌هوک‌ها
          </h2>
          <a href="/api/v1/openapi.json" target="_blank" className="text-sm text-blue-500 hover:underline">
            OpenAPI (JSON)
          </a>
        </div>

        <div className="p-6 space-y-4">
          {webhooks.length > 0 ? (
            <div className="space-y-4">
              {webhooks.map(hook => (
                <div key={hook.id} className="p-4 border rounded-2xl">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-medium break-all">{hook.url}</span>
                        <span dir="ltr" className="text-xs text-slate-400">secret {hook.secret_hint}</span>
                        {hook.active ? (
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                            فعال
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded">
                            غیرفعال
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex gap-1">
                        {hook.events.map(event => (
                          <span key={event} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                            {WEBHOOK_EVENTS.find(e => e.id === event)?.label || event}
                          </span>
                        ))}
                      </div>
                      {hook.description && (
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{hook.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleWebhook(hook.id, !hook.active)}
                        title={hook.active ? 'غیرفعال کردن' : 'فعال کردن'}
                        aria-label={hook.active ? 'غیرفعال کردن' : 'فعال کردن'}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        {hook.active ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                      <button
                        onClick={() => handleTestWebhook(hook.id)}
                        title="ارسال آزمایشی"
                        aria-label="ارسال آزمایشی"
                        className="text-green-500 hover:text-green-700"
                      >
                        <Send className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleRotateSecret(hook.id)}
                        title="چرخش کلید امضا"
                        aria-label="چرخش کلید امضا"
                        className="text-yellow-500 hover:text-yellow-700"
                      >
                        <RefreshCw className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDeleteWebhook(hook.id)}
                        title="حذف"
                        aria-label="حذف"
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">هیچ وب‌هوک ای یافت نشد</p>
          )}

          <form
            onSubmit={e => {
              e.preventDefault();
              handleCreateWebhook(new FormData(e.currentTarget));
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">آدرس HTTPS</label>
                <input
                  name="url"
                  type="url"
                  required
                  className="w-full p-2 border rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                  placeholder="https://example.com/webhook"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">توضیحات (اختیاری)</label>
                <input
                  name="description"
                  className="w-full p-2 border rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                  placeholder="توضیحات وب‌هوک"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">رویدادها</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {WEBHOOK_EVENTS.map(event => (
                  <label key={event.id} className="flex items-center gap-2">
                    <input type="checkbox" name={`event_${event.id}`} />
                    <span>{event.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
            >
              ایجاد وب‌هوک
            </button>
          </form>

          {showNewSecret && (
            <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-200">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">کلید امضای جدید ایجاد شد</h3>
                  <p className="text-sm text-yellow-700 mt-1">
                    این کلید امضا فقط یک‌بار نمایش داده می‌شود. لطفاً آن را کپی کنید.
                  </p>
                </div>
                <button onClick={() => setShowNewSecret(null)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-md border flex items-center gap-2 overflow-x-auto">
                <code dir="ltr" className="text-sm break-all select-all">{showNewSecret.secret}</code>
                <button
                  onClick={() => copyToClipboard(showNewSecret.secret)}
                  className="mr-auto text-blue-500 hover:text-blue-700"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deliveries Section */}
      <div className="rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold">گزارش ارسال‌ها</h2>
        </div>
        <div className="p-6">
          {deliveries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-sm font-medium">رویداد</th>
                    <th className="p-3 text-sm font-medium">وضعیت</th>
                    <th className="p-3 text-sm font-medium">تلاش‌ها</th>
                    <th className="p-3 text-sm font-medium">کد پاسخ</th>
                    <th className="p-3 text-sm font-medium">زمان</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map(delivery => (
                    <tr key={delivery.id} className="border-b last:border-b-0">
                      <td className="p-3">
                        {WEBHOOK_EVENTS.find(e => e.id === delivery.event)?.label || delivery.event}
                      </td>
                      <td className="p-3">
                        {delivery.status === 'success' && (
                          <span className="text-green-500">موفق</span>
                        )}
                        {delivery.status === 'failed' && (
                          <span className="text-red-500">ناموفق</span>
                        )}
                        {delivery.status === 'pending' && (
                          <span className="text-yellow-500">در انتظار</span>
                        )}
                      </td>
                      <td className="p-3">{delivery.attempts}</td>
                      <td className="p-3">
                        {delivery.last_status_code || '—'}
                      </td>
                      <td className="p-3">
                        {new Date(delivery.created_at).toLocaleString('fa-IR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">هیچ گزارش ارسالی یافت نشد</p>
          )}
        </div>
      </div>
    </div>
  );
}
