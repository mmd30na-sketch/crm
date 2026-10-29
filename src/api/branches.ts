// Multi-branch (چندشعبه) API client + the x-branch-id header used by every /api request.
import { getAuthToken } from './client';

export interface BranchLite { id: number; name: string; code: string; is_default: boolean }
export interface BranchConfig { enabled: boolean; multi: boolean; branches: BranchLite[]; active: number | 'all'; can_see_all: boolean }
export interface Branch {
  id: number; code: string; name: string; is_default: boolean; is_active: boolean;
  academy_name?: string | null; address?: string | null; phone?: string | null; sms_sender_line?: string | null; manager_name?: string | null;
  students?: number; enrollments?: number; users?: number;
}
export type BranchInput = Partial<Omit<Branch, 'id' | 'is_default' | 'students' | 'enrollments' | 'users'>>;
export interface UserBranches { username: string; full_name?: string; role?: string; branch_ids: number[] }
export interface BranchReportRow {
  branch_id: number; name: string; is_active?: boolean; students: number; enrollments: number;
  tuition_total: number; paid_total: number; expenses_total: number; remaining_total: number;
}
export interface BranchReport { from: string | null; to: string | null; rows: BranchReportRow[]; totals: Omit<BranchReportRow, 'branch_id' | 'name' | 'is_active'> }
export interface BranchSettings { branch_id: number; name: string; academy_name: string | null; address: string | null; phone: string | null; sms_sender_line: string | null; manager_name: string | null }

export const BRANCH_KEY = 'ham_taraz_crm_branch';
export function getActiveBranch(): string | null {
  try { return sessionStorage.getItem(BRANCH_KEY); } catch { return null; }
}
export function setActiveBranch(v: string | null) {
  try { if (v) sessionStorage.setItem(BRANCH_KEY, v); else sessionStorage.removeItem(BRANCH_KEY); } catch { /* private mode */ }
}

/**
 * Adds `x-branch-id` to same-origin /api requests while a branch is selected. Nothing else about the request
 * changes (headers, body, errors). Without a stored branch (the normal single-branch case) it is a pass-through.
 */
let installed = false;
export function installBranchHeader() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const branch = getActiveBranch();
    if (!branch) return original(input, init);
    let url: URL | null = null;
    try { url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href); } catch { url = null; }
    if (!url || url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return original(input, init);
    if (input instanceof Request && !init) {
      if (input.headers.has('x-branch-id')) return original(input);
      const headers = new Headers(input.headers);
      headers.set('x-branch-id', branch);
      return original(new Request(input, { headers }));
    }
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('x-branch-id')) headers.set('x-branch-id', branch);
    return original(input, { ...(init || {}), headers });
  };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const t = getAuthToken(); if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `خطا ${res.status}`);
  return data as T;
}

const DISABLED: BranchConfig = { enabled: false, multi: false, branches: [], active: 'all', can_see_all: true };
export async function fetchBranchConfig(): Promise<BranchConfig> {
  try { return { ...DISABLED, ...(await call<BranchConfig>('/branches/config')) }; } catch { return DISABLED; }
}
export const fetchBranches = () => call<{ branches: Branch[] }>('/branches').then((r) => r.branches || []);
export const createBranch = (data: BranchInput) => call<{ branch: Branch }>('/branches', { method: 'POST', body: JSON.stringify(data) });
export const updateBranch = (id: number, data: BranchInput) => call<{ branch: Branch }>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const setDefaultBranch = (id: number) => call<{ success: boolean }>(`/branches/${id}/default`, { method: 'POST' });
export const fetchUserBranches = () => call<{ users: UserBranches[] }>('/branches/users').then((r) => r.users || []);
export const updateUserBranches = (username: string, branchIds: number[]) =>
  call<{ username: string; branch_ids: number[] }>(`/branches/users/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({ branch_ids: branchIds }) });
export function fetchBranchReport(from?: string, to?: string) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const s = q.toString();
  return call<BranchReport>(`/branches/report${s ? `?${s}` : ''}`);
}
export const fetchActiveBranchSettings = () => call<BranchSettings>('/branches/active-settings');
