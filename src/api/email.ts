// Email API client: status, contacts, templates (+preview), transactional send, campaigns, send log.
import { getAuthToken } from './client';

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
const post = <T>(path: string, body: unknown, method = 'POST') => call<T>(path, { method, body: JSON.stringify(body ?? {}) });

export type EmailStatus = {
  enabled: boolean; configured: boolean; test_to_masked: string; max_per_hour: number; throttle_ms: number;
  from_masked: string; unsubscribe_ready: boolean; mysql: boolean;
};
export type DeliverStatus = 'sent' | 'failed' | 'dry_run' | 'skipped_unsubscribed' | 'skipped_no_email' | 'skipped_disabled' | 'rate_limited';
export type TemplateKey = 'receipt' | 'certificate' | 'reminder' | 'campaign';
export type EmailTemplate = { key: TemplateKey; title: string; subject: string; body: string; vars: string[]; overridden: boolean };
export type Contact = { student_id: number; name: string; email_masked: string; has_email: boolean; unsubscribed: boolean };
export type Filters = { target: 'all' | 'course' | 'debtors'; course_id?: number | null; min_debt?: number | null };
export type Campaign = {
  id: number; name: string; subject: string; body: string; filters: Filters | null; status: 'draft' | 'sending' | 'done' | 'cancelled';
  dry_run: boolean; total: number; sent: number; failed: number; skipped: number; created_by: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
};
export type CampaignPreview = {
  with_email: number; unsubscribed: number; will_send: number; capped: boolean;
  sample: { name: string; email_masked: string }[]; rendered: { subject: string; html: string }; status: EmailStatus;
};
export type LogRow = {
  id: number; kind: 'transactional' | 'campaign'; template_key: string | null; campaign_id: number | null; student_id: number | null;
  to_masked: string | null; subject: string | null; status: DeliverStatus; test_override: boolean; error: string | null;
  created_by: string | null; created_at: string;
};
export type SendInput = {
  template_key: Exclude<TemplateKey, 'campaign'>; student_id: number; payment_id?: number; enrollment_id?: number;
  vars?: Record<string, string>; dry_run: boolean;
};

export const getEmailStatus = () => call<EmailStatus>('/email/status');
export const listContacts = (q = '', onlyWithEmail = false) =>
  call<Contact[]>(`/email/contacts?${new URLSearchParams({ q, ...(onlyWithEmail ? { only_with_email: '1' } : {}) })}`);
export const setContactEmail = (studentId: number, email: string) =>
  post<{ ok: true; has_email: boolean; email_masked?: string }>(`/email/contacts/${studentId}`, { email }, 'PUT');
export const listTemplates = () => call<EmailTemplate[]>('/email/templates');
export const saveTemplate = (key: TemplateKey, subject: string, body: string) => post<{ ok: true }>(`/email/templates/${key}`, { subject, body }, 'PUT');
export const resetTemplate = (key: TemplateKey) => call<{ ok: true }>(`/email/templates/${key}`, { method: 'DELETE' });
export const previewTemplate = (key: TemplateKey, input: { student_id?: number; payment_id?: number; enrollment_id?: number; vars?: Record<string, string>; subject?: string; body?: string }) =>
  post<{ subject: string; html: string; text: string; to_masked: string }>(`/email/templates/${key}/preview`, input);
export const sendEmail = (input: SendInput) => post<{ status: DeliverStatus; to_masked: string; test_override: boolean }>('/email/send', input);
export const previewCampaign = (input: { subject: string; body: string; filters: Filters }) => post<CampaignPreview>('/email/campaigns/preview', input);
export const listCampaigns = () => call<Campaign[]>('/email/campaigns');
export const createCampaign = (input: { name: string; subject: string; body: string; filters: Filters }) => post<{ id: number }>('/email/campaigns', input);
export const sendCampaign = (id: number, dry_run: boolean, confirm?: string) =>
  post<{ ok: true; total: number; dry_run: boolean; test_override: boolean }>(`/email/campaigns/${id}/send`, { dry_run, confirm });
export const cancelCampaign = (id: number) => post<{ ok: boolean }>(`/email/campaigns/${id}/cancel`, {});
export const getEmailLog = (p: { kind?: string; campaign_id?: number; status?: string; limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v)); });
  return call<{ rows: LogRow[]; total: number }>(`/email/log?${qs}`);
};
