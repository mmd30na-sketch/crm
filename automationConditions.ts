/**
 * Automation rules: pure condition evaluation, validation and text rendering (no I/O).
 * Shared by automation.ts (engine + routes). Field catalog and Persian labels live here.
 */
export type AutomationEvent = 'enrollment_created' | 'enrollment_approved' | 'enrollment_rejected' | 'payment_succeeded'
  | 'installment_due' | 'installment_overdue' | 'debt_above_threshold' | 'daily';
export const SCHEDULED_EVENTS: AutomationEvent[] = ['installment_due','installment_overdue','debt_above_threshold','daily'];
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
export type EventContext = {
  student_id?: number; enrollment_id?: number; payment_id?: number; installment_id?: number; registration_code?: string;
  first_name?: string; last_name?: string; mobile?: string; course_title?: string; course_id?: number;
  amount?: number; debt?: number; due_date?: string; days_overdue?: number; days_until_due?: number;
  tracking_code?: string; reason?: string; pay_method?: string; date?: string; staff?: string;
};

export const EVENT_FIELDS: Record<AutomationEvent, Array<{ key: string; label: string; type: 'number'|'string' }>> = {
  enrollment_created: [
    { key: 'student_id', label: 'شناسه کارآموز', type: 'number' },
    { key: 'first_name', label: 'نام', type: 'string' },
    { key: 'last_name', label: 'نام خانوادگی', type: 'string' },
    { key: 'course_title', label: 'دوره', type: 'string' },
    { key: 'course_id', label: 'شناسه دوره', type: 'number' },
    { key: 'amount', label: 'مبلغ (تومان)', type: 'number' },
    { key: 'debt', label: 'مانده بدهی (تومان)', type: 'number' }
  ],
  enrollment_approved: [
    { key: 'student_id', label: 'شناسه کارآموز', type: 'number' },
    { key: 'first_name', label: 'نام', type: 'string' },
    { key: 'last_name', label: 'نام خانوادگی', type: 'string' },
    { key: 'course_title', label: 'دوره', type: 'string' },
    { key: 'course_id', label: 'شناسه دوره', type: 'number' },
    { key: 'amount', label: 'مبلغ (تومان)', type: 'number' },
    { key: 'debt', label: 'مانده بدهی (تومان)', type: 'number' },
    { key: 'tracking_code', label: 'کد پیگیری', type: 'string' }
  ],
  enrollment_rejected: [
    { key: 'first_name', label: 'نام', type: 'string' },
    { key: 'last_name', label: 'نام خانوادگی', type: 'string' },
    { key: 'course_title', label: 'دوره', type: 'string' },
    { key: 'tracking_code', label: 'کد پیگیری', type: 'string' },
    { key: 'reason', label: 'دلیل', type: 'string' }
  ],
  payment_succeeded: [
    { key: 'student_id', label: 'شناسه کارآموز', type: 'number' },
    { key: 'first_name', label: 'نام', type: 'string' },
    { key: 'last_name', label: 'نام خانوادگی', type: 'string' },
    { key: 'amount', label: 'مبلغ (تومان)', type: 'number' },
    { key: 'pay_method', label: 'روش پرداخت', type: 'string' },
    { key: 'debt', label: 'مانده بدهی (تومان)', type: 'number' },
    { key: 'course_title', label: 'دوره', type: 'string' }
  ],
  installment_due: [
    { key: 'student_id', label: 'شناسه کارآموز', type: 'number' },
    { key: 'first_name', label: 'نام', type: 'string' },
    { key: 'last_name', label: 'نام خانوادگی', type: 'string' },
    { key: 'amount', label: 'مبلغ (تومان)', type: 'number' },
    { key: 'due_date', label: 'تاریخ سررسید', type: 'string' },
    { key: 'days_until_due', label: 'روز تا سررسید', type: 'number' },
    { key: 'debt', label: 'مانده بدهی (تومان)', type: 'number' },
    { key: 'course_title', label: 'دوره', type: 'string' }
  ],
  installment_overdue: [
    { key: 'student_id', label: 'شناسه کارآموز', type: 'number' },
    { key: 'first_name', label: 'نام', type: 'string' },
    { key: 'last_name', label: 'نام خانوادگی', type: 'string' },
    { key: 'amount', label: 'مبلغ (تومان)', type: 'number' },
    { key: 'due_date', label: 'تاریخ سررسید', type: 'string' },
    { key: 'days_overdue', label: 'روز تأخیر', type: 'number' },
    { key: 'debt', label: 'مانده بدهی (تومان)', type: 'number' },
    { key: 'course_title', label: 'دوره', type: 'string' }
  ],
  debt_above_threshold: [
    { key: 'student_id', label: 'شناسه کارآموز', type: 'number' },
    { key: 'first_name', label: 'نام', type: 'string' },
    { key: 'last_name', label: 'نام خانوادگی', type: 'string' },
    { key: 'debt', label: 'مانده بدهی (تومان)', type: 'number' },
    { key: 'course_title', label: 'دوره', type: 'string' }
  ],
  daily: [
    { key: 'date', label: 'تاریخ', type: 'string' }
  ]
};

export const FIELD_LABELS: Record<string, string> = {
  student_id: 'شناسه کارآموز',
  first_name: 'نام',
  last_name: 'نام خانوادگی',
  course_title: 'دوره',
  course_id: 'شناسه دوره',
  amount: 'مبلغ (تومان)',
  debt: 'مانده بدهی (تومان)',
  due_date: 'تاریخ سررسید',
  days_overdue: 'روز تأخیر',
  days_until_due: 'روز تا سررسید',
  tracking_code: 'کد پیگیری',
  reason: 'دلیل',
  pay_method: 'روش پرداخت',
  date: 'تاریخ'
};

export const EVENT_LABELS: Record<AutomationEvent, string> = {
  enrollment_created: 'ثبت‌نام جدید',
  enrollment_approved: 'تأیید ثبت‌نام آنلاین',
  enrollment_rejected: 'رد ثبت‌نام آنلاین',
  payment_succeeded: 'پرداخت موفق',
  installment_due: 'سررسید قسط',
  installment_overdue: 'قسط معوق',
  debt_above_threshold: 'بدهی بالاتر از حد',
  daily: 'روزانه (زمان‌بندی‌شده)'
};

export function isGroup(x: unknown): x is ConditionGroup {
  return typeof x === 'object' && x !== null && 'mode' in x && 'items' in x &&
    (x.mode === 'all' || x.mode === 'any') && Array.isArray(x.items);
}

function normalizePersianDigits(str: string): string {
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  const latinDigits = '0123456789';
  return str.split('').map(c => {
    const idx = persianDigits.indexOf(c);
    return idx >= 0 ? latinDigits[idx] : c;
  }).join('');
}

const toNum = (x: unknown): number => {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return NaN;
  const t = normalizePersianDigits(x).replace(/[,\u066C\s]/g, '');
  return t === '' ? NaN : Number(t);
};
function compareNumeric(a: unknown, b: unknown): number | null {
  const numA = toNum(a); const numB = toNum(b);
  if (!Number.isFinite(numA) || !Number.isFinite(numB)) return null;
  return numA - numB;
}

function evaluateCondition(cond: Condition, ctx: EventContext): boolean {
  const fieldValue = ctx[cond.field as keyof EventContext];
  const value = cond.value;

  switch (cond.op) {
    case 'eq': {
      const numCompare = compareNumeric(fieldValue, value);
      if (numCompare !== null) return numCompare === 0;
      return String(fieldValue ?? '').trim() === String(value ?? '').trim();
    }
    case 'neq': {
      const numCompare = compareNumeric(fieldValue, value);
      if (numCompare !== null) return numCompare !== 0;
      return String(fieldValue ?? '').trim() !== String(value ?? '').trim();
    }
    case 'gt': {
      const numCompare = compareNumeric(fieldValue, value);
      return numCompare !== null && numCompare > 0;
    }
    case 'gte': {
      const numCompare = compareNumeric(fieldValue, value);
      return numCompare !== null && numCompare >= 0;
    }
    case 'lt': {
      const numCompare = compareNumeric(fieldValue, value);
      return numCompare !== null && numCompare < 0;
    }
    case 'lte': {
      const numCompare = compareNumeric(fieldValue, value);
      return numCompare !== null && numCompare <= 0;
    }
    case 'contains':
      return String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase());
    case 'not_contains':
      return !String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase());
    case 'empty':
      return fieldValue === null || fieldValue === undefined || fieldValue === '';
    case 'not_empty':
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
    case 'in': {
      const values = Array.isArray(value) ? value : String(value || '').split(',');
      return values.some(v => String(fieldValue ?? '').trim() === String(v).trim());
    }
    default:
      return false;
  }
}

export function evaluateConditions(group: ConditionGroup | null | undefined, ctx: EventContext): boolean {
  // No (or an empty) group matches everything; a malformed group never matches.
  if (!group) return true;
  if (!isGroup(group)) return false;
  if (!group.items.length) return true;
  const results = group.items.map((item) => (isGroup(item) ? evaluateConditions(item, ctx) : evaluateCondition(item as Condition, ctx)));
  return group.mode === 'all' ? results.every(Boolean) : results.some(Boolean);
}

function countLeaves(group: ConditionGroup): number {
  let count = 0;
  for (const item of group.items) {
    if (isGroup(item)) {
      count += countLeaves(item);
    } else {
      count++;
    }
  }
  return count;
}

const OPS: CondOp[] = ['eq','neq','gt','gte','lt','lte','contains','not_contains','empty','not_empty','in'];

/** Normalizes a condition tree for one event; unknown fields/ops, depth > 3 or > 30 leaves are rejected. */
export function validateConditions(group: unknown, event: AutomationEvent): { ok: true; value: ConditionGroup } | { ok: false; error: string } {
  if (group === null || group === undefined) return { ok: true, value: { mode: 'all', items: [] } };
  if (!isGroup(group)) return { ok: false, error: 'ساختار شرط‌ها نامعتبر است.' };
  const allowed = new Set((EVENT_FIELDS[event] || []).map((f) => f.key));
  let leaves = 0;
  const walk = (g: ConditionGroup, depth: number): ConditionGroup | string => {
    if (depth > 3) return 'حداکثر سه سطح گروه شرط مجاز است.';
    const items: Array<Condition | ConditionGroup> = [];
    for (const raw of g.items) {
      if (isGroup(raw)) {
        const sub = walk(raw, depth + 1);
        if (typeof sub === 'string') return sub;
        items.push(sub);
        continue;
      }
      const c = raw as any;
      if (!c || typeof c !== 'object') return 'شرط نامعتبر است.';
      const field = String(c.field || '');
      if (!allowed.has(field)) return `فیلد «${FIELD_LABELS[field] || field}» برای این رویداد مجاز نیست.`;
      if (!OPS.includes(c.op)) return 'عملگر شرط نامعتبر است.';
      let value: Condition['value'];
      if (c.op === 'empty' || c.op === 'not_empty') value = undefined;
      else if (Array.isArray(c.value)) value = c.value.slice(0, 50).map((v: unknown) => (typeof v === 'number' ? v : String(v ?? '').trim().slice(0, 100)));
      else if (typeof c.value === 'number') value = c.value;
      else value = String(c.value ?? '').trim().slice(0, 200);
      if (value === '' && c.op !== 'contains' && c.op !== 'not_contains' && c.op !== 'eq' && c.op !== 'neq') return `برای شرط «${FIELD_LABELS[field] || field}» مقدار وارد کنید.`;
      items.push({ field, op: c.op, ...(value !== undefined ? { value } : {}) });
      leaves += 1;
    }
    return { mode: g.mode === 'any' ? 'any' : 'all', items };
  };
  const out = walk(group, 1);
  if (typeof out === 'string') return { ok: false, error: out };
  if (leaves > 30) return { ok: false, error: 'حداکثر ۳۰ شرط مجاز است.' };
  return { ok: true, value: out };
}

export function validateActions(actions: unknown): { ok: true; value: AutomationAction[] } | { ok: false; error: string } {
  if (!Array.isArray(actions)) {
    return { ok: false, error: 'عملیات باید یک آرایه باشد' };
  }

  if (actions.length === 0 || actions.length > 10) {
    return { ok: false, error: 'حداقل 1 و حداکثر 10 عملیات مجاز است' };
  }

  const validatedActions: AutomationAction[] = [];

  for (const action of actions) {
    if (typeof action !== 'object' || action === null) {
      return { ok: false, error: 'هر عملیات باید یک شی باشد' };
    }

    if ('type' in action) {
      switch (action.type) {
        case 'sms_template':
          if (typeof action.template_key !== 'string' || !/^[a-z0-9_]{1,60}$/.test(action.template_key)) {
            return { ok: false, error: 'کلید قالب پیامک نامعتبر است' };
          }
          validatedActions.push({ type: 'sms_template', template_key: action.template_key.trim() });
          break;
        case 'sms_text':
          if (typeof action.text !== 'string' || action.text.trim().length === 0 || action.text.trim().length > 500) {
            return { ok: false, error: 'متن پیامک باید بین 1 تا 500 کاراکتر باشد' };
          }
          validatedActions.push({ type: 'sms_text', text: action.text.trim() });
          break;
        case 'task':
          if (typeof action.title !== 'string' || action.title.trim().length === 0 || action.title.trim().length > 200) {
            return { ok: false, error: 'عنوان وظیفه باید بین 1 تا 200 کاراکتر باشد' };
          }
          validatedActions.push({
            type: 'task',
            title: action.title.trim(),
            description: typeof action.description === 'string' ? action.description.trim().slice(0, 1000) : undefined,
            assignee: typeof action.assignee === 'string' && action.assignee.trim() ? action.assignee.trim().slice(0, 80) : undefined,
            due_in_days: (() => { const n = Number(action.due_in_days ?? 1); return Number.isInteger(n) && n >= 0 && n <= 365 ? n : 1; })(),
            priority: (['low','normal','high'] as const).includes(action.priority) ? action.priority : 'normal'
          });
          break;
        case 'notify_admin':
          if (typeof action.text !== 'string' || action.text.trim().length === 0 || action.text.trim().length > 500) {
            return { ok: false, error: 'متن اعلان باید بین 1 تا 500 کاراکتر باشد' };
          }
          if (!['telegram','rubika'].includes(action.channel)) {
            return { ok: false, error: 'کانال اعلان نامعتبر است' };
          }
          validatedActions.push({
            type: 'notify_admin',
            channel: action.channel,
            text: action.text.trim()
          });
          break;
        case 'note':
          if (typeof action.text !== 'string' || action.text.trim().length === 0 || action.text.trim().length > 500) {
            return { ok: false, error: 'متن یادداشت باید بین 1 تا 500 کاراکتر باشد' };
          }
          validatedActions.push({ type: 'note', text: action.text.trim() });
          break;
        default:
          return { ok: false, error: 'نوع عملیات نامعتبر است' };
      }
    } else {
      return { ok: false, error: 'عملیات باید نوع داشته باشد' };
    }
  }

  return { ok: true, value: validatedActions };
}

export function renderText(tpl: string, ctx: EventContext): string {
  const replacements: Record<string, string> = {
    '{name}': ctx.first_name || '',
    '{family}': ctx.last_name || '',
    '{course}': ctx.course_title || '',
    '{amount}': ctx.amount !== undefined ? Number(ctx.amount).toLocaleString('fa-IR') : '',
    '{debt}': ctx.debt !== undefined ? Number(ctx.debt).toLocaleString('fa-IR') : '',
    '{date}': ctx.date || '',
    '{due_date}': ctx.due_date || '',
    '{days_overdue}': ctx.days_overdue !== undefined ? String(ctx.days_overdue) : '',
    '{tracking_code}': ctx.tracking_code || '',
    '{reason}': ctx.reason || ''
  };

  let result = String(tpl || '');
  for (const [placeholder, value] of Object.entries(replacements)) result = result.split(placeholder).join(value);
  return result;
}

export function smsVars(ctx: EventContext): Record<string, string> {
  return {
    name: ctx.first_name || '',
    family: ctx.last_name || '',
    course: ctx.course_title || '',
    amount: ctx.amount !== undefined ? Number(ctx.amount).toLocaleString('fa-IR') : '',
    debt: ctx.debt !== undefined ? Number(ctx.debt).toLocaleString('fa-IR') : '',
    date: ctx.date || '',
    due_date: ctx.due_date || '',
    days_overdue: ctx.days_overdue !== undefined ? String(ctx.days_overdue) : '',
    tracking_code: ctx.tracking_code || '',
    reason: ctx.reason || ''
  };
}

export function dedupeKey(event: AutomationEvent, ctx: EventContext, bucket?: string): string {
  const mainId = ctx.payment_id || ctx.installment_id || ctx.enrollment_id || ctx.registration_code || ctx.student_id || '';
  const key = `${event}:${mainId}${bucket ? `:${bucket}` : ''}`;
  return key.length > 120 ? key.substring(0, 120) : key;
}
