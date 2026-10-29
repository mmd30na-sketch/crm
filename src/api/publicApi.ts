// Public API (/api/v1) keys + outbound webhooks: admin client (Settings → API و وب‌هوک).
import { getAuthToken } from './client';

export type ApiKey = {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  rate_limit_per_min: number;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type WebhookSub = {
  id: number;
  url: string;
  events: string[];
  secret_hint: string;
  active: boolean;
  description: string | null;
  created_at: string;
};

export type Delivery = {
  id: number;
  subscription_id: number;
  event: string;
  event_id: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
};

export const WEBHOOK_EVENTS = [
  { id: 'enrollment.created', label: 'ثبت‌نام جدید' },
  { id: 'enrollment.approved', label: 'تأیید ثبت‌نام آنلاین' },
  { id: 'enrollment.rejected', label: 'رد ثبت‌نام آنلاین' },
  { id: 'payment.succeeded', label: 'پرداخت موفق' },
  { id: 'student.created', label: 'کارآموز جدید' }
];

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const t = getAuthToken();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `خطا ${res.status}`);
  return data as T;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return call<ApiKey[]>('/settings/api-keys');
}

export async function createApiKey(params: {
  name: string;
  scopes: string[];
  rate_limit_per_min: number;
}): Promise<{ id: number; key: string; prefix: string }> {
  return call<{ id: number; key: string; prefix: string }>('/settings/api-keys', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

export async function revokeApiKey(id: number): Promise<void> {
  await call(`/settings/api-keys/${id}/revoke`, { method: 'POST' });
}

export async function listWebhooks(): Promise<WebhookSub[]> {
  return call<WebhookSub[]>('/settings/webhooks');
}

export async function createWebhook(params: {
  url: string;
  events: string[];
  description?: string;
}): Promise<{ id: number; secret: string }> {
  return call<{ id: number; secret: string }>('/settings/webhooks', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

export async function setWebhookActive(id: number, active: boolean): Promise<void> {
  await call(`/settings/webhooks/${id}/active`, {
    method: 'POST',
    body: JSON.stringify({ active })
  });
}

export async function rotateWebhookSecret(id: number): Promise<{ secret: string }> {
  return call<{ secret: string }>(`/settings/webhooks/${id}/rotate-secret`, {
    method: 'POST'
  });
}

export async function deleteWebhook(id: number): Promise<void> {
  await call(`/settings/webhooks/${id}`, { method: 'DELETE' });
}

export async function testWebhook(id: number): Promise<{ ok: boolean; status?: number; error?: string }> {
  return call<{ ok: boolean; status?: number; error?: string }>(`/settings/webhooks/${id}/test`, {
    method: 'POST'
  });
}

export async function listDeliveries(subscriptionId?: number): Promise<Delivery[]> {
  const params = subscriptionId ? `?subscription_id=${subscriptionId}` : '';
  return call<Delivery[]>(`/settings/webhooks/deliveries${params}`);
}

