// Official invoices (فاکتور رسمی) API client.
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

export interface Seller {
  legal_name: string;
  economic_code: string;
  national_id: string;
  registration_no: string;
  postal_code: string;
  address: string;
  phone: string;
}

export interface InvoiceSettings {
  seller: Seller;
  prefix: string;
  vat_enabled: boolean;
  vat_rate: number;
  price_includes_vat: boolean;
  default_notes: string;
  footer_text: string;
}

export interface Buyer {
  full_name: string;
  national_code: string;
  phone: string;
  address: string;
  father_name: string;
}

export interface InvoiceItem {
  id?: number;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  net?: number;
  tax_rate?: number;
  tax_amount?: number;
  total?: number;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  issue_date_jalali: string;
  status: 'issued' | 'cancelled';
  student_id: number;
  enrollment_id: number | null;
  seller: Seller;
  buyer: Buyer;
  items: InvoiceItem[];
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  footer_text?: string;
}

export interface InvoiceDraft {
  student_id: number;
  enrollment_id: number | null;
  buyer: Buyer;
  items: InvoiceItem[];
  issue_date_jalali: string;
}

export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  return call<InvoiceSettings>('/invoices/settings');
}

export async function saveInvoiceSettings(settings: InvoiceSettings): Promise<InvoiceSettings> {
  return call<InvoiceSettings>('/invoices/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function listInvoices(query: {
  from?: string;
  to?: string;
  status?: string;
  q?: string;
}): Promise<Invoice[]> {
  const params = new URLSearchParams();
  if (query.from) params.append('from', query.from);
  if (query.to) params.append('to', query.to);
  if (query.status) params.append('status', query.status);
  if (query.q) params.append('q', query.q);
  return call<Invoice[]>(`/invoices?${params.toString()}`);
}

export async function getInvoice(id: number): Promise<Invoice> {
  return call<Invoice>(`/invoices/${id}`);
}

export async function draftFromEnrollment(enrollment_id: number): Promise<InvoiceDraft> {
  return call<InvoiceDraft>('/invoices/draft', {
    method: 'POST',
    body: JSON.stringify({ enrollment_id }),
  });
}

export async function createInvoice(data: {
  student_id: number;
  enrollment_id?: number | null;
  issue_date_jalali?: string;
  items: InvoiceItem[];
  notes?: string;
}): Promise<Invoice> {
  return call<Invoice>('/invoices', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function cancelInvoice(id: number, reason: string): Promise<Invoice> {
  return call<Invoice>(`/invoices/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function exportInvoices(
  query: { from?: string; to?: string; status?: string },
  format: 'csv' | 'xls'
): Promise<void> {
  const params = new URLSearchParams();
  if (query.from) params.append('from', query.from);
  if (query.to) params.append('to', query.to);
  if (query.status) params.append('status', query.status);
  params.append('format', format);
  await download(`/invoices/export?${params.toString()}`, `invoices.${format}`);
}

