// Zarinpal gateway settings API client («تنظیمات > درگاه پرداخت»). Secrets are write-only.
import { getAuthToken } from './client';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const t = getAuthToken(); if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `خطا ${res.status}`);
  return data as T;
}

export type ZpSource = 'saved' | 'env' | 'default';
export interface ZarinpalSettingsView {
  merchant_id_masked: string;
  merchant_id_set: boolean;
  merchant_id_valid: boolean;
  sandbox: boolean;
  currency: 'IRR' | 'IRT';
  public_base_url: string;
  payment_link_base: string;
  access_token_set: boolean;
  sources: Record<'merchant_id' | 'sandbox' | 'currency' | 'public_base_url' | 'payment_link_base' | 'access_token', ZpSource>;
  status: 'not_configured' | 'invalid_merchant' | 'sandbox' | 'live';
}
export interface ZarinpalSettingsPatch {
  merchant_id?: string; clear_merchant_id?: boolean;
  access_token?: string; clear_access_token?: boolean;
  sandbox?: boolean | null; currency?: string;
  public_base_url?: string; payment_link_base?: string;
}
export interface ZpTestResult {
  merchant: { ok: boolean; message: string };
  api: { ok: boolean; skipped?: boolean; message: string };
  settings: ZarinpalSettingsView;
}
export interface ZpTerminal { id: string; status: string; domain: string; name: string; matches_merchant: boolean }
export interface ZpSession { id: string; created_at: string; amount_rial: number; amount_toman: number; status: string; description: string; rrn: string; card: string }
export interface ZpTransactions { terminals: ZpTerminal[]; terminal_id: string | null; limit: number; offset: number; sessions: ZpSession[] }

export const getZarinpalSettings = () => call<ZarinpalSettingsView>('/settings/zarinpal');
export const saveZarinpalSettings = (patch: ZarinpalSettingsPatch) =>
  call<{ success: boolean; settings: ZarinpalSettingsView }>('/settings/zarinpal', { method: 'POST', body: JSON.stringify(patch) });
export const testZarinpal = () => call<ZpTestResult>('/settings/zarinpal/test', { method: 'POST', body: '{}' });
export const fetchZarinpalTransactions = (q: { terminal_id?: string; limit?: number; offset?: number } = {}) => {
  const p = new URLSearchParams();
  if (q.terminal_id) p.set('terminal_id', q.terminal_id);
  if (q.limit) p.set('limit', String(q.limit));
  if (q.offset) p.set('offset', String(q.offset));
  const qs = p.toString();
  return call<ZpTransactions>(`/settings/zarinpal/transactions${qs ? `?${qs}` : ''}`);
};
