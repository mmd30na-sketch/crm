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
export interface ZpTransactions { terminals: ZpTerminal[]; terminal_id: string | null; total: number; by_status: Record<string, number>; truncated: boolean; sessions: ZpSession[] }

export type HamrazConfirmKey = 'sms_send' | 'telegram' | 'rubika';
export interface HamrazSettingsView {
  enabled: boolean; configured: boolean; api_url: string; api_key_set: boolean; model: string;
  max_iterations: number; sql_enabled: boolean; sms_direct: boolean;
  confirm: Record<HamrazConfirmKey, boolean>;
  sources: Record<string, ZpSource>;
}
export interface HamrazPatch {
  enabled?: boolean; api_url?: string; api_key?: string; clear_api_key?: boolean; model?: string;
  max_iterations?: number | null; sql_enabled?: boolean; sms_direct?: boolean; confirm?: Partial<Record<HamrazConfirmKey, boolean>>;
}
export interface HamrazTestResult { ok: boolean; status: number | null; model: string; ms: number; message: string; settings: HamrazSettingsView }
export const getHamrazSettings = () => call<HamrazSettingsView>('/settings/hamraz');
export const saveHamrazSettings = (patch: HamrazPatch) =>
  call<{ success: boolean; settings: HamrazSettingsView }>('/settings/hamraz', { method: 'POST', body: JSON.stringify(patch) });
export const testHamraz = () => call<HamrazTestResult>('/settings/hamraz/test', { method: 'POST', body: '{}' });
export const getZarinpalSettings = () => call<ZarinpalSettingsView>('/settings/zarinpal');
export const saveZarinpalSettings = (patch: ZarinpalSettingsPatch) =>
  call<{ success: boolean; settings: ZarinpalSettingsView }>('/settings/zarinpal', { method: 'POST', body: JSON.stringify(patch) });
export const testZarinpal = () => call<ZpTestResult>('/settings/zarinpal/test', { method: 'POST', body: '{}' });
export const fetchZarinpalTransactions = (q: { terminal_id?: string } = {}) => {
  const qs = q.terminal_id ? `terminal_id=${encodeURIComponent(q.terminal_id)}` : '';
  return call<ZpTransactions>(`/settings/zarinpal/transactions${qs ? `?${qs}` : ''}`);
};
