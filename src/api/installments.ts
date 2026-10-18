// Installment schedule + reminder API client (staff session, like the other CRM clients).
import { getAuthToken } from './client';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const t = getAuthToken(); if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `خطا ${res.status}`);
  return data as T;
}

export type InstallmentStatus = 'unpaid' | 'paid' | 'cancelled';

export interface InstallmentRow {
  id: number; student_id: number; enrollment_id: number; seq: number; amount: number;
  due_date_jalali: string; status: InstallmentStatus; paid_at: string | null; online_payment_id: number | null;
  created_by: string | null; created_at: string; notes: string | null;
  student_name: string; phone_masked: string; course_title: string; course_number: number | null;
}

export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  unpaid: 'پرداخت‌نشده', paid: 'پرداخت‌شده', cancelled: 'لغوشده',
};

export interface InstallmentQuery { enrollment_id?: number; student_id?: number; status?: InstallmentStatus | ''; from?: string; to?: string }
export const listInstallments = (q: InstallmentQuery = {}) => {
  const p = new URLSearchParams();
  if (q.enrollment_id) p.set('enrollment_id', String(q.enrollment_id));
  if (q.student_id) p.set('student_id', String(q.student_id));
  if (q.status) p.set('status', q.status);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  const qs = p.toString();
  return call<InstallmentRow[]>(`/installments${qs ? `?${qs}` : ''}`);
};
export const createInstallment = (body: { enrollment_id: number; amount: number; due_date_jalali: string; notes?: string }) =>
  call<{ ok: true; id: number; seq: number }>('/installments', { method: 'POST', body: JSON.stringify({ ...body, split: false }) });
export const splitInstallments = (body: { enrollment_id: number; count: number; start_date_jalali: string; notes?: string }) =>
  call<{ ok: true; ids: number[]; count: number; total: number; remaining: number }>('/installments', { method: 'POST', body: JSON.stringify({ ...body, split: true }) });
export const updateInstallment = (id: number, body: { amount?: number; due_date_jalali?: string; notes?: string }) =>
  call<{ ok: true }>(`/installments/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const cancelInstallment = (id: number) =>
  call<{ ok: true }>(`/installments/${id}/cancel`, { method: 'POST', body: '{}' });
export const createInstallmentLink = (id: number) =>
  call<{ code: string; url: string; expires_at: string | null; amount: number }>(`/installments/${id}/link`, { method: 'POST', body: '{}' });

/* ── reminder settings / preview / log (admin) ── */
export interface ReminderStatusView {
  enabled: boolean; days_before: number; template_id: number; cron: string;
  test_mode: boolean; test_mobile_masked: string; configured: boolean; timezone: string; env_enabled: boolean;
}
export interface ReminderPreviewItem {
  installment_id: number; name_masked: string; mobile_masked: string; amount: number; amount_text: string;
  due_date: string; link_preview: string; text_preview: string; would_send: boolean; reason: string;
}
export interface ReminderPreview extends ReminderStatusView {
  target_date: string; total: number; would_send: number; items: ReminderPreviewItem[];
}
export interface ReminderLogRow {
  id: number; installment_id: number; send_day: string; mobile_masked: string | null;
  status: string; provider_message_id: string | null; error: string | null; created_at: string;
}

export const getReminderSettings = () => call<ReminderStatusView>('/installment-reminders/settings');
export const saveReminderSettings = (body: { enabled?: boolean; days_before?: number; template_id?: number; cron?: string; test_mobile?: string }) =>
  call<{ ok: true; enabled: boolean; days_before: number; template_id: number; cron: string }>('/installment-reminders/settings', { method: 'PUT', body: JSON.stringify(body) });
export const previewReminders = (days?: number) =>
  call<ReminderPreview>(`/installment-reminders/preview${days !== undefined ? `?days=${days}` : ''}`);
export const reminderLog = (limit = 200) => call<ReminderLogRow[]>(`/installment-reminders/log?limit=${limit}`);
export const runRemindersNow = (body: { confirm: string; dry_run?: boolean; days?: number }) =>
  call<{ ok: true; dry_run: boolean; sent: number; failed: number; skipped: number; dry_run_count: number; results: Array<{ installment_id: number; status: string; reason?: string }> }>('/installment-reminders/run-now', { method: 'POST', body: JSON.stringify(body) });
