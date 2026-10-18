// Remaining-debt SMS API client («ارسال به بدهکاران»).
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

export type DebtSmsReason = 'ok' | 'already_sent' | 'no_debt' | 'no_mobile' | 'test_mode_skip' | 'disabled' | 'not_configured' | 'link_failed';
export type DebtSmsStatus = 'sending' | 'sent' | 'failed' | 'skipped_test_mode';

export interface DebtSmsSettings {
  enabled: boolean;
  env_enabled: boolean;
  template_id: number;
  test_mode: boolean;
  test_mobile_masked: string;
  test_mobile_env: boolean;
  configured: boolean;
  payment_base: string;
  today: string;
  timezone: string;
}

export interface DebtSmsPreviewItem {
  student_id: number; name_masked: string; mobile_masked: string; debt: number; amount_text: string;
  would_send: boolean; reason: DebtSmsReason; text_preview: string;
}

export interface DebtSmsPreview extends DebtSmsSettings {
  total: number;
  would_send: number;
  items: DebtSmsPreviewItem[];
}

export interface DebtSmsLogRow {
  id: number; student_id: number; name_masked: string; send_day: string; mobile_masked: string;
  amount: number; link_code: string | null; status: DebtSmsStatus; provider_message_id: string | null;
  error: string | null; created_by: string | null; created_at: string;
}

export interface DebtSmsSendResult {
  ok: true; status: DebtSmsStatus | 'already_sent' | 'skipped'; reason: DebtSmsReason | null;
}

export const REASON_LABEL: Record<DebtSmsReason, string> = {
  ok: 'آماده ارسال',
  already_sent: 'امروز ارسال شده',
  no_debt: 'بدون بدهی',
  no_mobile: 'بدون موبایل معتبر',
  test_mode_skip: 'حالت آزمایشی (ارسال نمی‌شود)',
  disabled: 'ارسال غیرفعال است',
  not_configured: 'درگاه پیامک تنظیم نشده',
  link_failed: 'ساخت لینک ناموفق',
};

export const STATUS_LABEL: Record<DebtSmsStatus, string> = {
  sending: 'در حال ارسال',
  sent: 'ارسال‌شده',
  failed: 'ناموفق',
  skipped_test_mode: 'رد شده (حالت آزمایشی)',
};

export const getDebtSmsSettings = () => call<DebtSmsSettings>('/debt-sms/settings');
export const saveDebtSmsSettings = (body: { enabled?: boolean; template_id?: number; test_mobile?: string }) =>
  call<DebtSmsSettings & { ok: true }>('/debt-sms/settings', { method: 'PUT', body: JSON.stringify(body) });
export const previewDebtSms = (termId?: number | null) =>
  call<DebtSmsPreview>(`/debt-sms/preview${termId ? `?term_id=${encodeURIComponent(String(termId))}` : ''}`);
export const debtSmsLog = (limit = 200) => call<DebtSmsLogRow[]>(`/debt-sms/log?limit=${limit}`);
export const sendDebtSmsToStudent = (studentId: number, confirm: string) =>
  call<DebtSmsSendResult>(`/debt-sms/student/${studentId}`, { method: 'POST', body: JSON.stringify({ confirm }) });
export const sendDebtSmsBulk = (body: { confirm: string; term_id?: number | null; student_ids?: number[]; dry_run?: boolean }) =>
  call<{ ok: true; dry_run: boolean; sent: number; failed: number; skipped: number; dry_run_count: number; results: Array<{ student_id: number; status: string; reason?: string }> }>(
    '/debt-sms/bulk', { method: 'POST', body: JSON.stringify(body) });
