// Lead pipeline (Kanban) API client: stages, board, moves, owner, notes, conversion report.
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

/* ---------- Types ---------- */
export type StageColor =
  | 'slate'
  | 'sky'
  | 'amber'
  | 'indigo'
  | 'emerald'
  | 'rose'
  | 'violet'
  | 'teal'
  | 'orange';

export interface Stage {
  id: number;
  title: string;
  color: StageColor;
  position: number;
  status_key: string | null;
  is_won: boolean;
  is_lost: boolean;
  is_active: boolean;
  lead_count: number;
}

export interface PipelineLead {
  id: number;
  first_name: string | null;
  last_name: string;
  phone_masked: string;
  source_id: number | null;
  source_title: string | null;
  course_title: string | null;
  owner_username: string | null;
  stage_id: number | null;
  status: string;
  next_followup_date_jalali: string | null;
  created_at: string;
  stage_changed_at: string | null;
  notes_count: number;
}

export interface Note {
  id: number;
  body: string;
  staff_username: string | null;
  occurred_at: string | null;
}

export interface PipelineReport {
  range: { from: string | null; to: string | null };
  totals: {
    leads: number;
    won: number;
    lost: number;
    open: number;
    conversion_rate: number;
  };
  by_stage: {
    stage_id: number;
    title: string;
    color: StageColor;
    current: number;
    reached: number;
    reach_rate: number;
  }[];
  by_source: {
    source_id: number | null;
    title: string;
    leads: number;
    won: number;
    lost: number;
    conversion_rate: number;
  }[];
  by_period: {
    period: string;
    leads: number;
    won: number;
    conversion_rate: number;
  }[];
  avg_days_to_win: number | null;
}

export interface LeadSource {
  id: number;
  title: string;
  code: string;
}

export interface Assignee {
  username: string;
  full_name: string;
  role: string;
}

/* ---------- Endpoints ---------- */

// Stages
export const getStages = async (all = false): Promise<Stage[]> => {
  const qs = all ? '?all=1' : '';
  return call<Stage[]>(`/lead-pipeline/stages${qs}`);
};

export type StageInput = Partial<Pick<Stage, 'title' | 'color' | 'status_key' | 'is_won' | 'is_lost' | 'is_active'>>;
export const createStage = async (payload: StageInput): Promise<{ id: number }> => {
  return call<{ id: number }>('/lead-pipeline/stages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const updateStage = async (
  id: number,
  payload: StageInput
): Promise<{ ok: true }> => {
  return call<{ ok: true }>(`/lead-pipeline/stages/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
};

export const reorderStages = async (ids: number[]): Promise<void> => {
  await call<void>('/lead-pipeline/stages/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
};

export const deleteStage = async (id: number): Promise<void> => {
  await call<void>(`/lead-pipeline/stages/${id}`, { method: 'DELETE' });
};

// Board
export interface BoardResponse {
  stages: Stage[];
  leads: PipelineLead[];
}
export const getBoard = async (params: {
  source_id?: number;
  owner?: string;
  q?: string;
  course_id?: number;
}): Promise<BoardResponse> => {
  const qs = new URLSearchParams();
  if (params.source_id) qs.append('source_id', String(params.source_id));
  if (params.owner) qs.append('owner', params.owner);
  if (params.q) qs.append('q', params.q);
  if (params.course_id) qs.append('course_id', String(params.course_id));
  const path = `/lead-pipeline/board${qs.toString() ? '?' + qs : ''}`;
  return call<BoardResponse>(path);
};

// Lead actions
export const moveLead = async (leadId: number, stage_id: number): Promise<PipelineLead> => {
  return call<PipelineLead>(`/lead-pipeline/leads/${leadId}/move`, {
    method: 'POST',
    body: JSON.stringify({ stage_id }),
  });
};

export const setLeadOwner = async (
  leadId: number,
  owner_username: string | null
): Promise<{ ok: true; owner_username: string | null }> => {
  return call<{ ok: true; owner_username: string | null }>(`/lead-pipeline/leads/${leadId}/owner`, {
    method: 'PUT',
    body: JSON.stringify({ owner_username }),
  });
};

// Notes
export const getLeadNotes = async (leadId: number): Promise<Note[]> => {
  return call<Note[]>(`/lead-pipeline/leads/${leadId}/notes`);
};

export const addLeadNote = async (leadId: number, body: string): Promise<{ id: number }> => {
  return call<{ id: number }>(`/lead-pipeline/leads/${leadId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
};

// Report
export const getReport = async (params: {
  from?: string;
  to?: string;
  source_id?: number;
}): Promise<PipelineReport> => {
  const qs = new URLSearchParams();
  if (params.from) qs.append('from', params.from);
  if (params.to) qs.append('to', params.to);
  if (params.source_id) qs.append('source_id', String(params.source_id));
  const path = `/lead-pipeline/report?${qs}`;
  return call<PipelineReport>(path);
};

// Misc helpers
export const listLeadSources = async (): Promise<LeadSource[]> => {
  return call<LeadSource[]>('/leads/sources');
};

export const listAssignees = async (): Promise<Assignee[]> => {
  return call<Assignee[]>('/tasks/assignees');
};
