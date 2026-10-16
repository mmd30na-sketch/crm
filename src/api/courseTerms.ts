// Course terms («مدیریت دوره‌ها») API client.
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

export type TermStatus = 'active' | 'finished';
export interface CourseTerm {
  id: number; course_id: number; course_title: string; course_number: number; title: string | null;
  start_date: string | null; end_date: string | null; capacity: number | null; status: TermStatus; notes: string | null;
  enrolled: number; total_due: number; total_paid: number; remaining: number;
}
export interface TermStudent { id: number | null; first_name: string | null; last_name: string | null; phone_number: string | null; enrollment_id: number; signup_date_jalali: string | null; final_price: number; paid: number }
export type TermInput = { course_id?: number; course_number?: number; title?: string; start_date?: string; end_date?: string; capacity?: string | number | null; status: TermStatus; notes?: string };

export const TERM_STATUS_LABEL: Record<TermStatus, string> = { active: 'در حال برگزاری', finished: 'پایان‌یافته' };
export const listTerms = (q: { course_id?: string; status?: string } = {}) => {
  const p = new URLSearchParams();
  if (q.course_id && q.course_id !== 'all') p.set('course_id', q.course_id);
  if (q.status && q.status !== 'all') p.set('status', q.status);
  return call<CourseTerm[]>(`/course-terms?${p}`);
};
export const termStudents = (id: number) => call<TermStudent[]>(`/course-terms/${id}/students`);
export const createTerm = (b: TermInput) => call<{ id: number }>('/course-terms', { method: 'POST', body: JSON.stringify(b) });
export const updateTerm = (id: number, b: TermInput) => call<{ ok: true }>(`/course-terms/${id}`, { method: 'PUT', body: JSON.stringify(b) });
