import { getAuthToken } from './client';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const t = getAuthToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)
  if (init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `خطا ${res.status}`);
  return data as T;
}

export async function download(path: string, filename: string): Promise<void> {
  const headers = new Headers()
  const t = getAuthToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)
  const res = await fetch(`/api${path}`, { headers })
  if (!res.ok) {
    const d = await res.json().catch(() => ({ }))
    throw new Error((d as any)?.error || `خطا ${res.status}`)
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type Access = 'edit' | 'view' | 'masked' | 'hidden'
export type PolicyRole = 'cashier' | 'instructor' | 'api'
export interface FieldDef {
  id: string
  label: string
  description: string
  maskable: boolean
}
export interface FieldPolicyResponse {
  fields: FieldDef[]
  roles: { id: PolicyRole; label: string }[]
  policy: Record<PolicyRole, Record<string, Access>>
  defaults: Record<PolicyRole, Record<string, Access>>
  audit_enabled: boolean
}
export interface AccessLogRow {
  id: number
  username: string | null
  role: string | null
  method: string
  path: string
  fields: string[]
  records: number
  action: 'view' | 'blocked_edit' | 'file'
  created_at: string
}

export const ACCESS_LABEL: Record<Access, string> = {
  edit: 'ویرایش',
  view: 'مشاهده',
  masked: 'ماسک‌شده',
  hidden: 'پنهان',
}

export const ROLE_LABEL: Record<PolicyRole, string> = {
  cashier: 'صندوقدار',
  instructor: 'مدرس',
  api: 'کلید API',
}
export const ACTION_LABEL: Record<AccessLogRow['action'], string> = {
  view: 'مشاهده',
  blocked_edit: 'ویرایش ردشده',
  file: 'فایل',
}

// API Functions
export async function getFieldPolicy(): Promise<FieldPolicyResponse> {
  return call<FieldPolicyResponse>('/settings/field-policy')
}

export async function saveFieldPolicy(payload: {
  policy: Record<PolicyRole, Record<string, Access>>
  audit_enabled: boolean
}): Promise<FieldPolicyResponse> {
  return call<FieldPolicyResponse>('/settings/field-policy', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function resetFieldPolicy(): Promise<FieldPolicyResponse> {
  return call<FieldPolicyResponse>('/settings/field-policy/reset', {
    method: 'POST',
  })
}

export async function listFieldAccessLog(
  q: { username?: string; field?: string; limit?: number }
): Promise<AccessLogRow[]> {
  const search = new URLSearchParams()
  if (q.username) search.set('username', q.username)
  if (q.field) search.set('field', q.field)
  if (q.limit) search.set('limit', q.limit.toString())
  return call<AccessLogRow[]>(`/settings/field-access-log?${search}`)


}
