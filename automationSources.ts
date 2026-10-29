/**
 * Data sources for the automation engine (automation.ts): builds EventContext objects for the events emitted
 * from server.ts, for the daily scheduled events, and for previews. Read-only; MySQL first, JSON store
 * (db_store.json) as a fallback where the data exists there. Installments are MySQL-only (crm_installments).
 */
import { toJalaali, toGregorian } from 'jalaali-js';
import * as db from './mysql-socks';
import { owedByEnrollment } from './src/utils/finance';
import type { AutomationEvent, AutomationRule, EventContext } from './automationConditions';

const money = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const p2 = (n: number) => String(n).padStart(2, '0');

/** Jalali yyyy/mm/dd for "today + offset days" in Tehran. */
export function jalaliTehran(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day')) + offsetDays * 86_400_000);
  const { jy, jm, jd } = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${jy}/${p2(jm)}/${p2(jd)}`;
}
/** Whole days between two Jalali dates (b - a); null when either is malformed. */
export function jalaliDiffDays(a: string, b: string): number | null {
  const parse = (s: string) => { const m = String(s || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); if (!m) return null; const g = toGregorian(+m[1], +m[2], +m[3]); return Date.UTC(g.gy, g.gm - 1, g.gd); };
  const x = parse(a); const y = parse(b);
  return x === null || y === null ? null : Math.round((y - x) / 86_400_000);
}

export type SourceDeps = { readJsonDb: () => any };

export function createAutomationSources(deps: SourceDeps) {
  const mysql = () => db.isMysqlEnabled();

  /** Name / mobile / total remaining debt / latest course of one student. */
  async function studentContext(studentId: number): Promise<EventContext | null> {
    if (!Number.isInteger(studentId) || studentId <= 0) return null;
    if (mysql()) {
      const rows = await db.sql(
        `SELECT s.student_id, s.first_name, s.last_name, s.phone_number,
                (SELECT COALESCE(SUM(GREATEST(b.balance_due, 0)), 0) FROM v_enrollment_balances b WHERE b.student_id = s.student_id) AS debt,
                (SELECT c.title FROM enrollments e JOIN courses c ON c.course_id = e.course_id WHERE e.student_id = s.student_id ORDER BY e.enrollment_id DESC LIMIT 1) AS course_title
           FROM students s WHERE s.student_id = ? LIMIT 1`, [studentId]);
      const r: any = rows[0];
      if (!r) return null;
      return { student_id: Number(r.student_id), first_name: r.first_name || '', last_name: r.last_name || '', mobile: r.phone_number || '', debt: money(r.debt), course_title: r.course_title || '' };
    }
    const store = deps.readJsonDb();
    const s = (store.students || []).find((x: any) => Number(x.id) === studentId);
    if (!s) return null;
    const enr = (store.enrollments || []).filter((e: any) => Number(e.student_id) === studentId);
    const ids = new Set(enr.map((e: any) => Number(e.id)));
    const owed = owedByEnrollment(enr, (store.payments || []).filter((p: any) => p.enrollment_id && ids.has(Number(p.enrollment_id))));
    const last = [...enr].sort((a: any, b: any) => Number(b.id) - Number(a.id))[0];
    const course = last ? (store.courses || []).find((c: any) => Number(c.id) === Number(last.course_id)) : null;
    return { student_id: studentId, first_name: s.first_name || '', last_name: s.last_name || '', mobile: s.phone_number || '', debt: [...owed.values()].reduce((a, b) => a + Math.max(0, b), 0), course_title: course?.title || '' };
  }

  async function withStudent(studentId: number, extra: EventContext): Promise<EventContext | null> {
    const base = await studentContext(studentId);
    return base ? { ...base, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '')) } : null;
  }

  async function installmentContexts(kind: 'due' | 'overdue', daysBefore: number): Promise<EventContext[]> {
    if (!mysql()) return [];
    const today = jalaliTehran(0);
    const target = jalaliTehran(daysBefore);
    const rows = await db.sql(
      `SELECT i.id, i.student_id, i.enrollment_id, i.amount, i.due_date_jalali, s.first_name, s.last_name, s.phone_number, c.title AS course_title,
              (SELECT COALESCE(SUM(GREATEST(b.balance_due, 0)), 0) FROM v_enrollment_balances b WHERE b.student_id = i.student_id) AS debt
         FROM crm_installments i
         JOIN students s ON s.student_id = i.student_id
         LEFT JOIN enrollments e ON e.enrollment_id = i.enrollment_id
         LEFT JOIN courses c ON c.course_id = e.course_id
        WHERE i.status = 'unpaid' AND ${kind === 'due' ? 'i.due_date_jalali = ?' : 'i.due_date_jalali < ?'}
        ORDER BY i.due_date_jalali, i.id LIMIT 2000`, [kind === 'due' ? target : today]);
    return rows
      .filter((r: any) => money(r.debt) > 0) // an installment of a fully paid enrollment is not really due
      .map((r: any) => {
        const diff = jalaliDiffDays(today, String(r.due_date_jalali));
        return {
          installment_id: Number(r.id), student_id: Number(r.student_id), enrollment_id: Number(r.enrollment_id),
          first_name: r.first_name || '', last_name: r.last_name || '', mobile: r.phone_number || '', course_title: r.course_title || '',
          amount: money(r.amount), debt: money(r.debt), due_date: String(r.due_date_jalali),
          ...(kind === 'due' ? { days_until_due: diff ?? daysBefore } : { days_overdue: diff === null ? 0 : -diff }),
        };
      });
  }

  async function debtContexts(threshold: number): Promise<EventContext[]> {
    if (mysql()) {
      const rows = await db.sql(
        `SELECT s.student_id, s.first_name, s.last_name, s.phone_number, b.debt,
                (SELECT c.title FROM enrollments e JOIN courses c ON c.course_id = e.course_id WHERE e.student_id = s.student_id ORDER BY e.enrollment_id DESC LIMIT 1) AS course_title
           FROM students s
           JOIN (SELECT student_id, SUM(GREATEST(balance_due, 0)) AS debt FROM v_enrollment_balances GROUP BY student_id) b ON b.student_id = s.student_id
          WHERE b.debt > ? ORDER BY b.debt DESC LIMIT 2000`, [threshold]);
      return rows.map((r: any) => ({ student_id: Number(r.student_id), first_name: r.first_name || '', last_name: r.last_name || '', mobile: r.phone_number || '', debt: money(r.debt), course_title: r.course_title || '' }));
    }
    const store = deps.readJsonDb();
    const out: EventContext[] = [];
    for (const s of store.students || []) {
      const c = await studentContext(Number(s.id));
      if (c && (c.debt || 0) > threshold) out.push(c);
      if (out.length >= 2000) break;
    }
    return out;
  }

  async function scheduledContexts(event: AutomationEvent, rule: AutomationRule): Promise<EventContext[]> {
    const today = jalaliTehran(0);
    switch (event) {
      case 'installment_due': return (await installmentContexts('due', Number(rule.params?.days_before) || 0)).map((c) => ({ ...c, date: today }));
      case 'installment_overdue': return (await installmentContexts('overdue', 0)).map((c) => ({ ...c, date: today }));
      case 'debt_above_threshold': return (await debtContexts(Math.max(0, Number(rule.params?.threshold) || 0))).map((c) => ({ ...c, date: today }));
      case 'daily': return [{ date: today }];
      default: return [];
    }
  }

  /** Recent real records for previewing rules on instant events. */
  async function sampleContexts(event: AutomationEvent, limit: number): Promise<EventContext[]> {
    const n = Math.min(Math.max(limit, 1), 50);
    const today = jalaliTehran(0);
    if (event === 'enrollment_created' || event === 'enrollment_approved') {
      if (mysql()) {
        const rows = await db.sql(event === 'enrollment_approved'
          ? `SELECT e.enrollment_id, e.student_id, e.course_id, e.final_price, c.title, r.tracking_code
               FROM registrations r JOIN enrollments e ON e.student_id = r.student_id LEFT JOIN courses c ON c.course_id = e.course_id
              WHERE r.status = 'approved' ORDER BY r.registration_id DESC, e.enrollment_id DESC LIMIT ${n}`
          : `SELECT e.enrollment_id, e.student_id, e.course_id, e.final_price, c.title, NULL AS tracking_code
               FROM enrollments e LEFT JOIN courses c ON c.course_id = e.course_id ORDER BY e.enrollment_id DESC LIMIT ${n}`);
        const out: EventContext[] = [];
        for (const r of rows as any[]) {
          const c = await withStudent(Number(r.student_id), { enrollment_id: Number(r.enrollment_id), course_id: Number(r.course_id), course_title: r.title || '', amount: money(r.final_price), tracking_code: r.tracking_code || undefined, date: today });
          if (c) out.push(c);
        }
        return out;
      }
      if (event === 'enrollment_approved') return [];
      const store = deps.readJsonDb();
      const out: EventContext[] = [];
      for (const e of [...(store.enrollments || [])].sort((a: any, b: any) => Number(b.id) - Number(a.id)).slice(0, n)) {
        const course = (store.courses || []).find((c: any) => Number(c.id) === Number(e.course_id));
        const c = await withStudent(Number(e.student_id), { enrollment_id: Number(e.id), course_id: Number(e.course_id), course_title: course?.title || '', amount: money(e.final_price), date: today });
        if (c) out.push(c);
      }
      return out;
    }
    if (event === 'enrollment_rejected') {
      if (!mysql()) return [];
      const rows = await db.sql(`SELECT tracking_code, full_name, phone_number, category FROM registrations WHERE status = 'rejected' ORDER BY registration_id DESC LIMIT ${n}`);
      return rows.map((r: any) => registrationContext(r, ''));
    }
    if (event === 'payment_succeeded') {
      const list: any[] = mysql()
        ? await db.sql(`SELECT payment_id AS id, student_id, amount, pay_method FROM payments WHERE student_id IS NOT NULL ORDER BY payment_id DESC LIMIT ${n}`)
        : [...(deps.readJsonDb().payments || [])].sort((a: any, b: any) => Number(b.id) - Number(a.id)).slice(0, n);
      const out: EventContext[] = [];
      for (const p of list) {
        const c = await withStudent(Number(p.student_id), { payment_id: Number(p.id), amount: money(p.amount), pay_method: p.pay_method || '', date: today });
        if (c) out.push(c);
      }
      return out;
    }
    return [];
  }

  return { studentContext, withStudent, scheduledContexts, sampleContexts };
}

/** Context for an online registration row (approved/rejected flows); names are split on the first space. */
export function registrationContext(reg: any, reason: string, courseNames: Record<string, string> = {}): EventContext {
  const full = String(reg?.full_name || '').trim();
  const i = full.indexOf(' ');
  return {
    registration_code: String(reg?.tracking_code || ''), tracking_code: String(reg?.tracking_code || ''),
    first_name: i > 0 ? full.slice(0, i) : full, last_name: i > 0 ? full.slice(i + 1) : '',
    mobile: String(reg?.phone_number || ''), course_title: courseNames[String(reg?.category || '')] || String(reg?.category || ''),
    reason: reason || '', date: jalaliTehran(0),
  };
}
