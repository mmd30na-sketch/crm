// Client for «صاحب کسب‌وکار» and «سطوح کاربری» (Settings → تنظیمات هم‌راز). Admin-only server routes.
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
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export interface OwnerContact { name?: string; phone?: string; telegram?: string; rubika?: string; bale?: string; links?: Record<'phone' | 'telegram' | 'rubika' | 'bale', string | null> }
export const getOwner = () => call<{ owner: OwnerContact }>('/settings/business-owner').then((r) => r.owner);
export const saveOwner = (o: OwnerContact) => call<{ owner: OwnerContact }>('/settings/business-owner', json('POST', o)).then((r) => r.owner);

export type BaseRole = 'admin' | 'cashier' | 'instructor';
export interface Perm { key: string; label: string }
export interface Level { id: string; name: string; base_role: BaseRole; permissions: Record<string, boolean>; system?: boolean; users?: number }
export const getLevels = () => call<{ permissions: Perm[]; levels: Level[] }>('/access-levels');
export const createLevel = (l: Partial<Level>) => call<{ level: Level }>('/access-levels', json('POST', l));
export const updateLevel = (id: string, l: Partial<Level>) => call<{ level: Level }>(`/access-levels/${encodeURIComponent(id)}`, json('PUT', l));
export const deleteLevel = (id: string) => call<{ ok: boolean }>(`/access-levels/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface StaffUser { id: number; username: string; full_name: string; role: BaseRole; level_id: string | null; is_active: boolean; source: 'env' | 'local'; locked: boolean }
export const getStaff = () => call<{ users: StaffUser[] }>('/staff').then((r) => r.users);
export const createStaff = (u: { username: string; full_name: string; password: string; level_id: string; is_active?: boolean }) => call<{ user: StaffUser }>('/staff', json('POST', u));
export const updateStaff = (id: number, u: Partial<{ full_name: string; password: string; level_id: string; is_active: boolean }>) => call<{ user: StaffUser }>(`/staff/${id}`, json('PUT', u));
