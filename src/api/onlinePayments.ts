// Online installment payments API client.
// Staff functions use the CRM session token (like the other clients). Trainee functions are called with the
// signed trainee token from the ?t= panel link instead.
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

export type OnlineMethod = 'zarinpal' | 'receipt';
export type OnlineStatus = 'pending' | 'paid' | 'approved' | 'rejected';

export interface OnlinePaymentRow {
  id: number; student_id: number; enrollment_id: number; amount: number;
  method: OnlineMethod; ref_id: string | null; status: OnlineStatus; admin_note: string | null;
  created_at: string; reviewed_by: string | null; reviewed_at: string | null;
  student_name: string; phone_masked: string; course_title: string; course_number: number | null;
  receipt_file: string | null;
}

export const ONLINE_STATUS_LABEL: Record<OnlineStatus, string> = {
  pending: 'در انتظار بررسی', paid: 'پرداخت‌شده (زرین‌پال)', approved: 'تأییدشده', rejected: 'ردشده',
};
export const ONLINE_METHOD_LABEL: Record<OnlineMethod, string> = { zarinpal: 'زرین‌پال', receipt: 'رسید' };

export const listOnlinePayments = (status?: OnlineStatus | '') =>
  call<OnlinePaymentRow[]>(`/online-payments${status ? `?status=${status}` : ''}`);
export const approveOnlinePayment = (id: number) =>
  call<{ ok: true; payment: any; allocations: number }>(`/online-payments/${id}/approve`, { method: 'POST', body: '{}' });
export const rejectOnlinePayment = (id: number, admin_note: string) =>
  call<{ ok: true }>(`/online-payments/${id}/reject`, { method: 'POST', body: JSON.stringify({ admin_note }) });
export const createTraineeLink = (studentId: number) =>
  call<{ url: string; token: string; expires_in_days: number; student_name: string; phone_masked: string }>(
    `/online-payments/link/${studentId}`, { method: 'POST', body: '{}' });

/* ── trainee panel (signed token) ── */
export interface TraineeEnrollment {
  id: number; course_id: number; course_number: number | null; signup_date_jalali: string;
  final_price: number; remaining: number; course_title: string;
}
export interface TraineeMe { student: { id: number; first_name: string; last_name: string; phone_masked: string }; enrollments: TraineeEnrollment[] }
export interface TraineePayment {
  id: number; enrollment_id: number; amount: number; method: OnlineMethod; ref_id: string | null;
  status: OnlineStatus; admin_note: string | null; created_at: string; has_receipt: boolean;
}

async function traineeCall<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api/trainee-payments${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `خطا ${res.status}`);
  return data as T;
}

export const traineeMe = (token: string) => traineeCall<TraineeMe>(token, '/me');
export const traineePayments = (token: string) => traineeCall<TraineePayment[]>(token, '/payments');
export const traineeZarinpalRequest = (token: string, body: { enrollment_id: number; amount: number }) =>
  traineeCall<{ payment_url: string; authority: string; online_payment_id: number }>(token, '/zarinpal/request', { method: 'POST', body: JSON.stringify(body) });
export const traineeUploadReceipt = (token: string, body: { enrollment_id: number; amount: number; file: File }) => {
  const fd = new FormData();
  fd.append('enrollment_id', String(body.enrollment_id));
  fd.append('amount', String(body.amount));
  fd.append('receipt', body.file);
  return traineeCall<{ ok: true; id: number; status: OnlineStatus }>(token, '/receipt', { method: 'POST', body: fd });
};
export const traineeLogin = (student_id: number, national_last4: string) =>
  fetch('/api/trainee-payments/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id, national_last4 }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || 'ورود ناموفق بود');
    return data as { token: string; student: { id: number; first_name: string; last_name: string } };
  });
export const traineeReceiptUrl = (token: string, id: number) =>
  `/api/trainee-payments/receipts/${id}/file?t=${encodeURIComponent(token)}`;
