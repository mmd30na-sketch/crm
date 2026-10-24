// Instructor pay (حق‌التدریس) API client.
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

export type RateType = 'per_term' | 'per_session';
export interface Instructor { id: number; name: string; phone: string | null; active: boolean; notes: string | null; created_at?: string }
export interface Rate { id: number; instructor_id: number; instructor_name: string | null; course_term_id: number | null; term_label: string | null; rate_type: RateType; amount: number }
export interface SessionRow { id: number; instructor_id: number; instructor_name: string | null; course_term_id: number | null; term_label: string | null; session_date: string; hours: number; notes: string | null }
export interface ReportItem { rate_id: number; count?: number; amount: number; total?: number; term_id?: number; term_label?: string | null }
export interface ReportRow {
  instructor_id: number; name: string; phone: string | null; active: boolean;
  sessions_count: number; sessions_hours: number;
  per_session_items: ReportItem[]; per_session_total: number;
  per_term_items: ReportItem[]; per_term_total: number;
  total: number; settled: boolean; settled_id: number | null; settled_total: number | null; settled_at: string | null;
}
export interface Report { month: string; rows: ReportRow[] }
export type InstructorInput = { name: string; phone?: string; active: boolean; notes?: string };
export type RateInput = { instructor_id: number; course_term_id?: number | null; rate_type: RateType; amount: number };
export type SessionInput = { instructor_id: number; course_term_id?: number | null; session_date: string; hours?: number; notes?: string };

export const RATE_TYPE_LABEL: Record<RateType, string> = { per_term: 'به ازای هر دوره', per_session: 'به ازای هر جلسه' };

export const listInstructors = () => call<Instructor[]>('/instructor-pay/instructors');
export const getInstructor = (id: number) => call<Instructor>(`/instructor-pay/instructors/${id}`);
export const createInstructor = (b: InstructorInput) => call<{ id: number }>('/instructor-pay/instructors', { method: 'POST', body: JSON.stringify(b) });
export const updateInstructor = (id: number, b: InstructorInput) => call<{ ok: true }>(`/instructor-pay/instructors/${id}`, { method: 'PUT', body: JSON.stringify(b) });
export const deleteInstructor = (id: number) => call<{ ok: true }>(`/instructor-pay/instructors/${id}`, { method: 'DELETE' });

export const listRates = (instructorId?: number) => call<Rate[]>(`/instructor-pay/rates${instructorId ? `?instructor_id=${instructorId}` : ''}`);
export const createRate = (b: RateInput) => call<{ id: number }>('/instructor-pay/rates', { method: 'POST', body: JSON.stringify(b) });
export const updateRate = (id: number, b: RateInput) => call<{ ok: true }>(`/instructor-pay/rates/${id}`, { method: 'PUT', body: JSON.stringify(b) });
export const deleteRate = (id: number) => call<{ ok: true }>(`/instructor-pay/rates/${id}`, { method: 'DELETE' });

export const listSessions = (q: { instructor_id?: string; from?: string; to?: string } = {}) => {
  const p = new URLSearchParams();
  if (q.instructor_id && q.instructor_id !== 'all') p.set('instructor_id', q.instructor_id);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  return call<SessionRow[]>(`/instructor-pay/sessions?${p}`);
};
export const createSession = (b: SessionInput) => call<{ id: number }>('/instructor-pay/sessions', { method: 'POST', body: JSON.stringify(b) });
export const updateSession = (id: number, b: SessionInput) => call<{ ok: true }>(`/instructor-pay/sessions/${id}`, { method: 'PUT', body: JSON.stringify(b) });
export const deleteSession = (id: number) => call<{ ok: true }>(`/instructor-pay/sessions/${id}`, { method: 'DELETE' });

export const fetchReport = (month: string) => call<Report>(`/instructor-pay/report?month=${encodeURIComponent(month)}`);
export const markSettled = (b: { instructor_id: number; year_month: string; notes?: string }) =>
  call<{ ok: true; total: number }>('/instructor-pay/settlements', { method: 'POST', body: JSON.stringify(b) });
export const undoSettlement = (id: number) => call<{ ok: true }>(`/instructor-pay/settlements/${id}`, { method: 'DELETE' });
