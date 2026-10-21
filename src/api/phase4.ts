// Phase 4 API client: leads, activities, tasks, campaigns. Datetimes from the server are UTC without 'Z'.
import { getAuthToken } from './client';
import * as L from '../utils/labels';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const t = getAuthToken(); if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `خطا ${res.status}`);
  return data as T;
}
const post = <T>(p: string, b: unknown) => call<T>(p, { method: 'POST', body: JSON.stringify(b) });
const put = <T>(p: string, b: unknown) => call<T>(p, { method: 'PUT', body: JSON.stringify(b) });

export const utc = (s?: string | null) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : null);

export type LeadStatus = 'new' | 'contacted' | 'in_negotiation' | 'converted' | 'lost';
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = L.LEAD_STATUS_LABEL;
export interface Lead {
  id: number; first_name: string | null; last_name: string; phone_number: string; national_code: string | null;
  source_id: number | null; source_title: string | null; course_id: number | null; course_title: string | null;
  status: LeadStatus; next_followup_date_jalali: string | null; loss_reason: string | null; notes: string | null;
  converted_student_id: number | null; created_at: string; updated_at: string;
}
export type LeadInput = Partial<Pick<Lead, 'first_name' | 'last_name' | 'phone_number' | 'national_code' | 'source_id' | 'course_id' | 'status' | 'next_followup_date_jalali' | 'loss_reason' | 'notes'>>;
export const listLeads = (q: { status?: string; due?: boolean } = {}) =>
  call<Lead[]>(`/leads?${new URLSearchParams({ ...(q.status ? { status: q.status } : {}), ...(q.due ? { due: '1' } : {}) })}`);
export const listLeadSources = () => call<Array<{ id: number; title: string; code: string | null }>>('/leads/sources');
export const createLead = (b: LeadInput) => post<{ id: number }>('/leads', b);
export const updateLead = (id: number, b: LeadInput) => put<{ ok: true }>(`/leads/${id}`, b);
export const convertLead = (id: number, national_code?: string) => post<{ student_id: number; alreadyExists?: boolean; alreadyConverted?: boolean }>(`/leads/${id}/convert`, { national_code });

export type ActivityKind = 'call' | 'note' | 'sms' | 'in_person' | 'rubika';
export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = L.ACTIVITY_KIND_LABEL;
export interface Activity { id: number; kind: ActivityKind; outcome: string | null; body: string | null; staff_username: string | null; occurred_at: string }
export interface LinkedMessage { id: string; direction: 'in' | 'out'; source: 'account' | 'bot'; text: string; at: string }
export const listActivities = (entity_type: 'student' | 'lead', entity_id: number) =>
  call<{ activities: Activity[]; messages: LinkedMessage[] }>(`/activities?entity_type=${entity_type}&entity_id=${entity_id}`);
export const addActivity = (b: { entity_type: 'student' | 'lead'; entity_id: number; kind: ActivityKind; outcome?: string; body?: string; occurred_at?: string }) =>
  post<{ id: number }>('/activities', b);

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high';
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = L.TASK_STATUS_LABEL;
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = L.TASK_PRIORITY_LABEL;
export interface Task {
  id: number; title: string; description: string | null; assignee_username: string | null; created_by: string | null;
  due_at: string | null; priority: TaskPriority; status: TaskStatus; entity_type: 'student' | 'lead' | null; entity_id: number | null;
  entity_name: string | null; created_at: string; overdue: boolean;
}
export type TaskInput = Partial<Pick<Task, 'title' | 'description' | 'assignee_username' | 'priority' | 'status' | 'entity_type' | 'entity_id'>> & { due_at?: string | null };
export const listTasks = (q: { mine?: boolean; open?: boolean; entity_type?: string; entity_id?: number } = {}) => {
  const p = new URLSearchParams();
  if (q.mine) p.set('mine', '1'); if (q.open) p.set('open', '1');
  if (q.entity_type && q.entity_id) { p.set('entity_type', q.entity_type); p.set('entity_id', String(q.entity_id)); }
  return call<Task[]>(`/tasks?${p}`);
};
export const taskSummary = () => call<{ open: number; overdue: number }>('/tasks/summary');
export const listAssignees = () => call<Array<{ username: string; full_name: string; role: string }>>('/tasks/assignees');
export const createTask = (b: TaskInput) => post<{ id: number }>('/tasks', b);
export const updateTask = (id: number, b: TaskInput) => put<{ ok: true }>(`/tasks/${id}`, b);

export type CampaignChannel = 'rubika' | 'sms' | 'rubika_sms';
export interface CampaignFilters {
  target: 'students' | 'leads' | 'term'; course_id?: number; course_number?: number; debtors?: boolean; lead_status?: LeadStatus;
  /** target 'term': one crm_course_terms row, or every course with this course number. */
  term_id?: number; term_number?: number; channel?: CampaignChannel;
  exclude_students?: number[]; exclude_leads?: number[];
}
export interface CampaignPreview {
  total: number; routes: { account: number; bot: number; sms: number; none: number }; send_enabled: boolean; sms_configured: boolean; channel: CampaignChannel;
  /** Full list (max 2000); phone is masked; text is filled for the first 30 only. */
  recipients: Array<{ student_id: number | null; lead_id: number | null; name: string; phone: string; course?: string; route: 'account' | 'bot' | 'sms' | 'none'; text: string }>;
}
export interface Campaign { id: number; name: string; template: string; dry_run: 0 | 1; throttle_ms: number; status: string; created_by: string | null; total: number; sent: number; failed: number; skipped: number; created_at: string; finished_at: string | null }
export interface CampaignRecipient { id: number; name: string; phone: string; route: string | null; status: string; error: string | null; rendered: string; processed_at: string | null }
export const TEMPLATE_VARS = ['name', 'first_name', 'last_name', 'course', 'debt'] as const;
export const previewCampaign = (b: { template: string; filters: CampaignFilters }) => post<CampaignPreview>('/campaigns/preview', b);
export const listCampaigns = () => call<Campaign[]>('/campaigns');
export const campaignRecipients = (id: number) => call<CampaignRecipient[]>(`/campaigns/${id}/recipients`);
export const createCampaign = (b: { name: string; template: string; filters: CampaignFilters; dry_run: boolean; throttle_ms?: number; confirm?: string }) =>
  post<{ id: number; total: number; dry_run: boolean }>('/campaigns', b);
export const cancelCampaign = (id: number) => post<{ ok: true }>(`/campaigns/${id}/cancel`, {});
