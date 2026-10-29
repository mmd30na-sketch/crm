// Rule-based automation API client («اتوماسیون قاعده‌محور»), admin only.
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

export type AutomationEvent = 'enrollment_created' | 'enrollment_approved' | 'enrollment_rejected' | 'payment_succeeded'
  | 'installment_due' | 'installment_overdue' | 'debt_above_threshold' | 'daily';
export type CondOp = 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'contains'|'not_contains'|'empty'|'not_empty'|'in';
export type Condition = { field: string; op: CondOp; value?: string | number | Array<string|number> };
export type ConditionGroup = { mode: 'all' | 'any'; items: Array<Condition | ConditionGroup> };
export type AutomationAction =
  | { type: 'sms_template'; template_key: string }
  | { type: 'sms_text'; text: string }
  | { type: 'task'; title: string; description?: string; assignee?: string; due_in_days?: number; priority?: 'low'|'normal'|'high' }
  | { type: 'notify_admin'; channel: 'telegram' | 'rubika'; text: string }
  | { type: 'note'; text: string };
export type AutomationRule = {
  id: number; name: string; description: string; event: AutomationEvent;
  conditions: ConditionGroup; actions: AutomationAction[];
  enabled: boolean; dry_run: boolean;
  test_mobile: string;
  max_per_hour: number;
  params: { days_before?: number; threshold?: number; repeat_days?: number };
  created_by: string | null; created_at: string; updated_at: string;
};
export type RuleDraft = Omit<AutomationRule, 'id' | 'created_by' | 'created_at' | 'updated_at'> & { id?: number };
export type AutomationMeta = {
  enabled: boolean; test_mobile_env: boolean; test_mobile_masked: string; max_sms_per_day: number;
  daily_hour: number; telegram_configured: boolean; rubika_configured: boolean;
  events: {key: AutomationEvent; label: string; scheduled: boolean; fields: {key:string; label:string; type:'number'|'string'}[]}[];
  ops: {key: CondOp; label: string}[];
};
export type PreviewResult = {
  total_checked: number; matched: number;
  items: {name_masked:string; mobile_masked:string; student_id:number|null; actions:{type:string; preview:string; to_masked?:string}[]}[];
  warnings: string[];
};
export type AutomationRun = {
  id:number; rule_id:number; rule_name:string; event:string; dedupe_key:string; mode:'dry'|'live';
  status:string; target_masked:string|null; summary:string|null; actions_result:any;
  created_at:string; finished_at:string|null;
};

export async function getMeta(): Promise<AutomationMeta> {
  return call<AutomationMeta>('/automation/meta');
}

export async function listRules(): Promise<{rules: AutomationRule[]}> {
  return call<{rules: AutomationRule[]}>('/automation/rules');
}

export async function createRule(d: RuleDraft): Promise<AutomationRule> {
  return call<AutomationRule>('/automation/rules', {
    method: 'POST',
    body: JSON.stringify(d)
  });
}

export async function updateRule(id: number, d: Partial<RuleDraft>): Promise<AutomationRule> {
  return call<AutomationRule>(`/automation/rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(d)
  });
}

export async function deleteRule(id: number): Promise<void> {
  await call(`/automation/rules/${id}`, { method: 'DELETE' });
}

export async function toggleRule(id: number, patch: {enabled?: boolean; dry_run?: boolean}): Promise<AutomationRule> {
  return call<AutomationRule>(`/automation/rules/${id}/toggle`, {
    method: 'POST',
    body: JSON.stringify(patch)
  });
}

export async function previewRule(d: RuleDraft): Promise<PreviewResult> {
  return call<PreviewResult>('/automation/preview', {
    method: 'POST',
    body: JSON.stringify(d)
  });
}

export async function listRuns(opts: {rule_id?: number; limit?: number; offset?: number} = {}): Promise<{rows: AutomationRun[]; total: number}> {
  const params = new URLSearchParams();
  if (opts.rule_id) params.append('rule_id', opts.rule_id.toString());
  if (opts.limit) params.append('limit', opts.limit.toString());
  if (opts.offset) params.append('offset', opts.offset.toString());
  return call<{rows: AutomationRun[]; total: number}>(`/automation/runs?${params.toString()}`);
}

export type RunNowResult = { ok: true; live: boolean; rules: number; checked: number; matched: number; executed: number; duplicates: number; dry_runs: number; rate_limited: number };
export async function runNow(id: number, confirm?: string): Promise<RunNowResult> {
  return call<RunNowResult>(`/automation/rules/${id}/run-now`, {
    method: 'POST',
    body: JSON.stringify({confirm})
  });
}
