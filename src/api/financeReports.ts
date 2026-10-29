// Finance reports, refunds and accounting export API client.
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
/** File downloads (CSV/XLS) need the auth header too, so fetch -> blob -> object URL. */
export async function download(path: string, filename: string): Promise<void> {
  const headers = new Headers(); const t = getAuthToken(); if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as any)?.error || `خطا ${res.status}`); }
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type IncomeGroup = 'month' | 'day' | 'course' | 'instructor' | 'method';
export interface IncomeReport { group: IncomeGroup; rows: { key: string; label: string; count: number; amount: number }[]; total: number; refunds_total?: number; net_total?: number; note?: string }
export interface AgingReport { as_of: string; buckets: { key: string; label: string; amount: number; count: number }[]; rows: { student_id: number; student_name: string; enrollment_id: number; course_title: string; signup_date_jalali: string; final_price: number; paid: number; refunded: number; balance: number; age_days: number; bucket: string }[]; total: number }
export interface InstallmentsReport { summary: { unpaid_count: number; unpaid_amount: number; overdue_count: number; overdue_amount: number; paid_count: number; paid_amount: number }; rows: { id: number; student_name: string; course_title: string; seq: number; amount: number; due_date_jalali: string; status: 'unpaid' | 'paid' | 'cancelled'; overdue_days: number }[] }
export interface Refund { id: number; student_id: number; student_name: string; enrollment_id: number | null; amount: number; refund_date_jalali: string; method: string; reason: string; status: 'active' | 'void'; created_by: string | null; created_at: string }
export interface RefundsReport { rows: Refund[]; total: number }
export interface AccountingAdapter { id: string; label: string; formats: ('csv' | 'xls')[]; status: 'ready' | 'needs_confirmation' | 'stub'; notes: string }
export interface AccountingSettings {
  basis?: 'cash' | 'invoice'; accounts: { cash: string; bank: string; pos: string; online: string; receivable: string; revenue: string; vat_payable: string; refunds: string }; doc_description: string }

export async function incomeReport(params: { from?: string; to?: string; group?: IncomeGroup }) {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.group) query.set('group', params.group);
  return call<IncomeReport>(`/finance-reports/income?${query}`);
}

export async function agingReport(params: { as_of?: string }) {
  const query = new URLSearchParams();
  if (params.as_of) query.set('as_of', params.as_of);
  return call<AgingReport>(`/finance-reports/aging?${query}`);
}

export async function installmentsReport(params: { from?: string; to?: string; status?: string }) {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.status) query.set('status', params.status);
  return call<InstallmentsReport>(`/finance-reports/installments?${query}`);
}

export async function refundsReport(params: { from?: string; to?: string }) {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  return call<RefundsReport>(`/finance-reports/refunds?${query}`);
}

export async function createRefund(data: {
  student_id: number;
  enrollment_id?: number;
  amount: number;
  refund_date_jalali: string;
  method: string;
  reason: string;
}) {
  return call<Refund>('/refunds', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function voidRefund(id: number) {
  return call<Refund>(`/refunds/${id}/void`, { method: 'POST' });
}

export async function exportReport(
  name: 'income' | 'aging' | 'installments' | 'refunds',
  params: Record<string, string>,
  format: 'csv' | 'xls'
) {
  const query = new URLSearchParams(params);
  query.set('format', format);
  await download(`/finance-reports/${name}?${query}`, `${name}.${format}`);
}

export async function listAdapters() {
  return call<AccountingAdapter[]>('/accounting/adapters');
}

export async function getAccountingSettings() {
  return call<AccountingSettings>('/accounting/settings');
}

export async function saveAccountingSettings(settings: AccountingSettings) {
  return call<AccountingSettings>('/accounting/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function exportJournal(params: {
  adapter: string;
  format: 'csv' | 'xls';
  from?: string;
  to?: string;
}) {
  const query = new URLSearchParams();
  query.set('adapter', params.adapter);
  query.set('format', params.format);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  await download(`/accounting/export?${query}`, `journal-${(params.from || 'all').replace(/\//g, '')}.${params.format}`);
}

