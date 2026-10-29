/**
 * Richer financial reports + refunds (بازپرداخت).
 * - GET /api/finance-reports/income?from&to&group=month|day|course|instructor|method[&format=csv|xls]
 * - GET /api/finance-reports/aging?as_of            receivables aging (0-30 / 31-60 / 61-90 / 91-180 / >180 days)
 * - GET /api/finance-reports/installments?from&to&status
 * - GET /api/finance-reports/refunds?from&to
 * - POST /api/refunds, POST /api/refunds/:id/void   (admin only; a refund is never deleted)
 * Every report accepts ?format=csv|xls for a download. Reads reuse the server's loaders (MySQL or JSON store).
 * Additive only: one new table crm_refunds (JSON: "refunds"). Refunds are a separate ledger: they do not change
 * payments / v_enrollment_balances (the rest of the CRM keeps working the same); income shows gross, refunds
 * and net. Income by instructor needs MySQL (course terms + instructor rates/sessions).
 */
import type express from 'express';
import * as db from './mysql-socks';
import { jalaliToJdn } from './src/utils/jalali';
import { parseFormat, sendExport, type Column } from './exporters';
import { jalaliKey } from './invoices';

export type FinanceDeps = {
  session: (req: express.Request) => { username: string; role: string } | null;
  readJsonDb: () => any;
  writeJsonDb: (s: any) => void;
  loadStudents: () => Promise<any[]>;
  loadCourses: () => Promise<any[]>;
  loadEnrollments: () => Promise<any[]>;
  loadPayments: () => Promise<any[]>;
  jalaliToday: () => string;
  log: (m: string) => void;
};

export const PAY_METHOD_FA: Record<string, string> = { pos: 'کارتخوان', cash: 'نقدی', card_transfer: 'کارت‌به‌کارت', online: 'آنلاین', cheque: 'چک', bank: 'واریز به حساب', api: 'API' };
const REFUND_METHODS = ['cash', 'card_transfer', 'bank'] as const;
export const AGING_BUCKETS = [
  { key: '0_30', label: '۰ تا ۳۰ روز', max: 30 },
  { key: '31_60', label: '۳۱ تا ۶۰ روز', max: 60 },
  { key: '61_90', label: '۶۱ تا ۹۰ روز', max: 90 },
  { key: '91_180', label: '۹۱ تا ۱۸۰ روز', max: 180 },
  { key: '180_plus', label: 'بیش از ۱۸۰ روز', max: Infinity },
];
export const agingBucket = (days: number) => (AGING_BUCKETS.find((b) => days <= b.max) || AGING_BUCKETS[AGING_BUCKETS.length - 1]).key;

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const daysBetween = (a: string, b: string) => { const x = jalaliToJdn(a); const y = jalaliToJdn(b); return x === null || y === null ? 0 : y - x; };
const inRange = (d: string | null, from: string | null, to: string | null) => !!d && (!from || d >= from) && (!to || d <= to);
const name = (s: any) => (s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : '');

export type Refund = { id: number; student_id: number; student_name: string; enrollment_id: number | null; amount: number; refund_date_jalali: string; method: string; reason: string; status: 'active' | 'void'; created_by: string | null; created_at: string };

export async function ensureFinanceSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_refunds (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    enrollment_id INT NULL,
    amount BIGINT NOT NULL COMMENT 'Toman',
    refund_date_jalali CHAR(10) NOT NULL,
    method VARCHAR(30) NOT NULL DEFAULT 'cash',
    reason VARCHAR(300) NOT NULL,
    status ENUM('active','void') NOT NULL DEFAULT 'active',
    created_by VARCHAR(80) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    voided_by VARCHAR(80) NULL,
    voided_at DATETIME NULL,
    KEY idx_refund_date (refund_date_jalali),
    KEY idx_refund_student (student_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: refunds / بازپرداخت به کارآموز'`);
}

export function createFinance(deps: FinanceDeps) {
  const jsonRefunds = () => { const store = deps.readJsonDb(); if (!Array.isArray(store.refunds)) store.refunds = []; return { store, list: store.refunds as any[] }; };

  async function refunds(from: string | null, to: string | null, includeVoid = false): Promise<Refund[]> {
    const raw = db.isMysqlEnabled()
      ? await db.sql<any>('SELECT * FROM crm_refunds ORDER BY refund_date_jalali DESC, id DESC')
      : jsonRefunds().list.slice().reverse();
    const students = new Map((await deps.loadStudents()).map((s) => [Number(s.id), s]));
    return raw
      .filter((r: any) => inRange(jalaliKey(r.refund_date_jalali), from, to) && (includeVoid || r.status !== 'void'))
      .map((r: any) => ({
        id: Number(r.id), student_id: Number(r.student_id), student_name: name(students.get(Number(r.student_id))),
        enrollment_id: r.enrollment_id === null || r.enrollment_id === undefined ? null : Number(r.enrollment_id), amount: Number(r.amount),
        refund_date_jalali: r.refund_date_jalali, method: r.method, reason: r.reason, status: r.status,
        created_by: r.created_by ?? null, created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
      }));
  }

  async function createRefund(b: any, username: string) {
    const studentId = Number(b?.student_id);
    const amount = Math.round(Number(b?.amount));
    const date = jalaliKey(b?.refund_date_jalali || deps.jalaliToday());
    const method = String(b?.method || 'cash');
    const reason = String(b?.reason ?? '').trim().slice(0, 300);
    if (!Number.isInteger(studentId) || studentId <= 0) throw httpError(400, 'کارآموز مشخص نیست.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw httpError(400, 'مبلغ نامعتبر است.');
    if (!date) throw httpError(400, 'تاریخ نامعتبر است.');
    if (!(REFUND_METHODS as readonly string[]).includes(method)) throw httpError(400, 'روش بازپرداخت نامعتبر است.');
    if (!reason) throw httpError(400, 'علت بازپرداخت الزامی است.');
    if (!(await deps.loadStudents()).some((s) => Number(s.id) === studentId)) throw httpError(404, 'کارآموز پیدا نشد.');
    let enrollmentId: number | null = null;
    if (b?.enrollment_id) {
      enrollmentId = Number(b.enrollment_id);
      const e = (await deps.loadEnrollments()).find((x) => Number(x.id) === enrollmentId);
      if (!e || Number(e.student_id) !== studentId) throw httpError(400, 'ثبت‌نام متعلق به این کارآموز نیست.');
    }
    // Never refund more than the student actually paid (minus earlier refunds).
    const paid = (await deps.loadPayments()).filter((p) => Number(p.student_id) === studentId && (!enrollmentId || Number(p.enrollment_id) === enrollmentId))
      .reduce((a, p) => a + Number(p.amount || 0), 0);
    const already = (await refunds(null, null)).filter((r) => r.student_id === studentId && (!enrollmentId || r.enrollment_id === enrollmentId)).reduce((a, r) => a + r.amount, 0);
    if (amount > paid - already) throw httpError(400, `مبلغ بازپرداخت از پرداختی خالص کارآموز (${Math.max(paid - already, 0).toLocaleString('fa-IR')} تومان) بیشتر است.`);
    if (db.isMysqlEnabled()) {
      const r = await db.sqlExec('INSERT INTO crm_refunds (student_id, enrollment_id, amount, refund_date_jalali, method, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [studentId, enrollmentId, amount, date, method, reason, username || null]);
      return { id: r.insertId };
    }
    const { store, list } = jsonRefunds();
    const id = list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    list.push({ id, student_id: studentId, enrollment_id: enrollmentId, amount, refund_date_jalali: date, method, reason, status: 'active', created_by: username || null, created_at: new Date().toISOString() });
    deps.writeJsonDb(store);
    return { id };
  }

  async function voidRefund(id: number, username: string) {
    if (db.isMysqlEnabled()) {
      const r = await db.sqlExec("UPDATE crm_refunds SET status = 'void', voided_by = ?, voided_at = NOW() WHERE id = ? AND status = 'active'", [username || null, id]);
      if (!r.affectedRows) throw httpError(404, 'بازپرداخت فعال پیدا نشد.');
      return;
    }
    const { store, list } = jsonRefunds();
    const r = list.find((x) => Number(x.id) === id && x.status !== 'void');
    if (!r) throw httpError(404, 'بازپرداخت فعال پیدا نشد.');
    Object.assign(r, { status: 'void', voided_by: username || null, voided_at: new Date().toISOString() });
    deps.writeJsonDb(store);
  }

  /** enrollment -> instructor ids (MySQL only): term = (course_id, course_number); instructors via rates or sessions. */
  async function instructorsByEnrollmentKey(): Promise<{ map: Map<string, { id: number; name: string }[]> } | null> {
    if (!db.isMysqlEnabled()) return null;
    const rows = await db.sql<any>(`
      SELECT t.course_id, t.course_number, i.id AS instructor_id, i.name
      FROM crm_course_terms t
      JOIN (SELECT instructor_id, course_term_id FROM crm_instructor_rates WHERE course_term_id IS NOT NULL
            UNION SELECT instructor_id, course_term_id FROM crm_instructor_sessions WHERE course_term_id IS NOT NULL) x ON x.course_term_id = t.id
      JOIN crm_instructors i ON i.id = x.instructor_id`);
    const map = new Map<string, { id: number; name: string }[]>();
    for (const r of rows) {
      const k = `${r.course_id}:${r.course_number}`;
      const list = map.get(k) || [];
      if (!list.some((x) => x.id === Number(r.instructor_id))) list.push({ id: Number(r.instructor_id), name: r.name });
      map.set(k, list);
    }
    return { map };
  }

  async function income(from: string | null, to: string | null, group: string) {
    const payments = (await deps.loadPayments()).filter((p) => inRange(jalaliKey(p.pay_date_jalali), from, to));
    const enrollments = new Map((await deps.loadEnrollments()).map((e) => [Number(e.id), e]));
    const courses = new Map((await deps.loadCourses()).map((c) => [Number(c.id), c]));
    const acc = new Map<string, { key: string; label: string; count: number; amount: number }>();
    const add = (key: string, label: string, amount: number, count = 1) => {
      const r = acc.get(key) || { key, label, count: 0, amount: 0 };
      r.count += count; r.amount += amount; acc.set(key, r);
    };
    let note: string | undefined;
    const inst = group === 'instructor' ? await instructorsByEnrollmentKey() : null;
    if (group === 'instructor' && !inst) note = 'گزارش به تفکیک مربی فقط با پایگاه‌داده MySQL (ترم‌ها و نرخ/جلسات مربیان) در دسترس است.';
    for (const p of payments) {
      const amount = Number(p.amount || 0);
      const d = jalaliKey(p.pay_date_jalali) || '';
      const e = enrollments.get(Number(p.enrollment_id));
      if (group === 'day') add(d, d, amount);
      else if (group === 'course') {
        const cid = Number(e?.course_id ?? p.course_id ?? 0);
        add(`c${cid}`, courses.get(cid)?.title || p.course_title || 'بدون دوره', amount);
      } else if (group === 'method') add(String(p.pay_method || '-'), PAY_METHOD_FA[p.pay_method] || String(p.pay_method || 'نامشخص'), amount);
      else if (group === 'instructor') {
        const list = inst && e ? inst.map.get(`${e.course_id}:${e.course_number}`) || [] : [];
        if (!list.length) add('none', 'بدون مربی ثبت‌شده', amount);
        // Several instructors on one term: the payment is split equally so the total stays exact.
        else list.forEach((i, idx) => {
          const share = Math.floor(amount / list.length) + (idx === 0 ? amount % list.length : 0);
          add(`i${i.id}`, i.name, share, 1);
        });
      } else add(d.slice(0, 7), d.slice(0, 7), amount);
    }
    if (group === 'instructor' && inst) note = 'پرداخت‌های ترمی که چند مربی دارد به‌طور مساوی بین مربیان تقسیم شده است.';
    const rows = [...acc.values()].sort((a, b) => (['month', 'day'].includes(group) ? a.key.localeCompare(b.key) : b.amount - a.amount));
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const refundsTotal = (await refunds(from, to)).reduce((a, r) => a + r.amount, 0);
    return { group, rows, total, refunds_total: refundsTotal, net_total: total - refundsTotal, ...(note ? { note } : {}) };
  }

  async function aging(asOf: string) {
    const enrollments = await deps.loadEnrollments();
    const payments = await deps.loadPayments();
    const students = new Map((await deps.loadStudents()).map((s) => [Number(s.id), s]));
    const courses = new Map((await deps.loadCourses()).map((c) => [Number(c.id), c]));
    const paidBy = new Map<number, number>();
    for (const p of payments) {
      const d = jalaliKey(p.pay_date_jalali);
      if (p.enrollment_id === null || p.enrollment_id === undefined || (d && d > asOf)) continue;
      paidBy.set(Number(p.enrollment_id), (paidBy.get(Number(p.enrollment_id)) || 0) + Number(p.amount || 0));
    }
    const refundedBy = new Map<number, number>();
    for (const r of await refunds(null, asOf)) if (r.enrollment_id) refundedBy.set(r.enrollment_id, (refundedBy.get(r.enrollment_id) || 0) + r.amount);
    const rows = enrollments
      .filter((e) => { const d = jalaliKey(e.signup_date_jalali); return !d || d <= asOf; })
      .map((e) => {
        const finalPrice = Number(e.final_price || 0);
        const paid = paidBy.get(Number(e.id)) || 0;
        const signup = jalaliKey(e.signup_date_jalali) || asOf;
        const age = Math.max(daysBetween(signup, asOf), 0);
        return {
          student_id: Number(e.student_id), student_name: name(students.get(Number(e.student_id))), enrollment_id: Number(e.id),
          course_title: courses.get(Number(e.course_id))?.title || '', signup_date_jalali: signup, final_price: finalPrice, paid,
          refunded: refundedBy.get(Number(e.id)) || 0, balance: Math.max(finalPrice - paid, 0), age_days: age, bucket: agingBucket(age),
        };
      })
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.age_days - a.age_days);
    const buckets = AGING_BUCKETS.map((b) => {
      const rs = rows.filter((r) => r.bucket === b.key);
      return { key: b.key, label: b.label, amount: rs.reduce((a, r) => a + r.balance, 0), count: rs.length };
    });
    return { as_of: asOf, buckets, rows, total: rows.reduce((a, r) => a + r.balance, 0) };
  }

  async function installments(from: string | null, to: string | null, status: string) {
    const today = jalaliKey(deps.jalaliToday()) || '';
    let raw: any[];
    if (db.isMysqlEnabled()) raw = await db.sql<any>('SELECT id, student_id, enrollment_id, seq, amount, due_date_jalali, status FROM crm_installments ORDER BY due_date_jalali, id');
    else raw = Array.isArray(deps.readJsonDb().installments) ? deps.readJsonDb().installments : [];
    const students = new Map((await deps.loadStudents()).map((s) => [Number(s.id), s]));
    const enrollments = new Map((await deps.loadEnrollments()).map((e) => [Number(e.id), e]));
    const courses = new Map((await deps.loadCourses()).map((c) => [Number(c.id), c]));
    const rows = raw
      .filter((r) => inRange(jalaliKey(r.due_date_jalali), from, to) && (!status || status === 'all' || r.status === status))
      .map((r) => {
        const due = jalaliKey(r.due_date_jalali) || '';
        const overdue = r.status === 'unpaid' && due && due < today ? daysBetween(due, today) : 0;
        const e = enrollments.get(Number(r.enrollment_id));
        return {
          id: Number(r.id), student_name: name(students.get(Number(r.student_id))), course_title: e ? courses.get(Number(e.course_id))?.title || '' : '',
          seq: Number(r.seq || 1), amount: Number(r.amount || 0), due_date_jalali: due, status: r.status as 'unpaid' | 'paid' | 'cancelled', overdue_days: overdue,
        };
      });
    const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((a, r) => a + r.amount, 0);
    return {
      summary: {
        unpaid_count: rows.filter((r) => r.status === 'unpaid').length, unpaid_amount: sum((r) => r.status === 'unpaid'),
        overdue_count: rows.filter((r) => r.overdue_days > 0).length, overdue_amount: sum((r) => r.overdue_days > 0),
        paid_count: rows.filter((r) => r.status === 'paid').length, paid_amount: sum((r) => r.status === 'paid'),
      },
      rows,
    };
  }

  return { income, aging, installments, refunds, createRefund, voidRefund };
}

export function registerFinanceReports(app: express.Express, deps: FinanceDeps) {
  const fin = createFinance(deps);
  const who = (req: express.Request) => deps.session(req);
  const staff = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const s = who(req);
    if (!s) return res.status(401).json({ error: 'Unauthorized' });
    if (s.role !== 'admin' && s.role !== 'cashier') return res.status(403).json({ error: 'Forbidden' });
    next();
  };
  const adminOnly = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    (who(req)?.role === 'admin' ? next() : res.status(403).json({ error: 'فقط مدیر سیستم' }));
  const h = (fn: (req: express.Request, res: express.Response) => Promise<any>) => (req: express.Request, res: express.Response) => {
    fn(req, res).catch((e: any) => {
      if (!e?.status || e.status >= 500) deps.log(`finance: ${e?.message || e}`);
      res.status(e?.status || 500).json({ error: e?.status && e.status < 500 ? e.message : 'خطای داخلی سرور' });
    });
  };
  const range = (q: any) => {
    const from = q.from ? jalaliKey(q.from) : null; const to = q.to ? jalaliKey(q.to) : null;
    if ((q.from && !from) || (q.to && !to)) throw httpError(400, 'تاریخ نامعتبر است (yyyy/mm/dd شمسی).');
    return { from, to };
  };
  const fmt = (q: any) => { if (!q.format) return null; const f = parseFormat(q.format); if (!f) throw httpError(400, 'فرمت خروجی باید csv یا xls باشد.'); return f; };
  const fname = (n: string, from: string | null, to: string | null) => `${n}-${(from || 'start').replace(/\//g, '')}-${(to || 'now').replace(/\//g, '')}`;

  app.get('/api/finance-reports/income', staff, h(async (req, res) => {
    const { from, to } = range(req.query);
    const group = ['month', 'day', 'course', 'instructor', 'method'].includes(String(req.query.group)) ? String(req.query.group) : 'month';
    const r = await fin.income(from, to, group);
    const f = fmt(req.query);
    if (!f) return res.json(r);
    const cols: Column<any>[] = [{ header: 'عنوان', value: (x) => x.label, type: 'text' }, { header: 'تعداد پرداخت', value: (x) => x.count }, { header: 'مبلغ (تومان)', value: (x) => x.amount }];
    const rows = [...r.rows, { label: 'جمع', count: r.rows.reduce((a, x) => a + x.count, 0), amount: r.total }, { label: 'بازپرداخت‌ها', count: null, amount: -r.refunds_total }, { label: 'خالص', count: null, amount: r.net_total }];
    sendExport(res, f, fname(`income-${group}`, from, to), [{ name: 'Income', rows, columns: cols }]);
  }));

  app.get('/api/finance-reports/aging', staff, h(async (req, res) => {
    const asOf = req.query.as_of ? jalaliKey(req.query.as_of) : jalaliKey(deps.jalaliToday());
    if (!asOf) throw httpError(400, 'تاریخ نامعتبر است.');
    const r = await fin.aging(asOf);
    const f = fmt(req.query);
    if (!f) return res.json(r);
    const label = new Map(AGING_BUCKETS.map((b) => [b.key, b.label]));
    sendExport(res, f, `aging-${asOf.replace(/\//g, '')}`, [
      { name: 'Aging', rows: r.rows, columns: [
        { header: 'کارآموز', value: (x: any) => x.student_name }, { header: 'دوره', value: (x: any) => x.course_title },
        { header: 'شناسه ثبت‌نام', value: (x: any) => x.enrollment_id }, { header: 'تاریخ ثبت‌نام', value: (x: any) => x.signup_date_jalali, type: 'text' },
        { header: 'شهریه', value: (x: any) => x.final_price }, { header: 'پرداختی', value: (x: any) => x.paid }, { header: 'بازپرداخت', value: (x: any) => x.refunded },
        { header: 'مانده', value: (x: any) => x.balance }, { header: 'روز', value: (x: any) => x.age_days }, { header: 'بازه', value: (x: any) => label.get(x.bucket) },
      ] },
      { name: 'Buckets', rows: r.buckets, columns: [{ header: 'بازه', value: (x: any) => x.label }, { header: 'تعداد', value: (x: any) => x.count }, { header: 'مبلغ', value: (x: any) => x.amount }] },
    ]);
  }));

  app.get('/api/finance-reports/installments', staff, h(async (req, res) => {
    const { from, to } = range(req.query);
    const r = await fin.installments(from, to, String(req.query.status || 'all'));
    const f = fmt(req.query);
    if (!f) return res.json(r);
    const st: Record<string, string> = { unpaid: 'پرداخت‌نشده', paid: 'پرداخت‌شده', cancelled: 'لغوشده' };
    sendExport(res, f, fname('installments', from, to), [{ name: 'Installments', rows: r.rows, columns: [
      { header: 'کارآموز', value: (x: any) => x.student_name }, { header: 'دوره', value: (x: any) => x.course_title }, { header: 'قسط', value: (x: any) => x.seq },
      { header: 'مبلغ', value: (x: any) => x.amount }, { header: 'سررسید', value: (x: any) => x.due_date_jalali, type: 'text' },
      { header: 'وضعیت', value: (x: any) => st[x.status] || x.status }, { header: 'روز تأخیر', value: (x: any) => x.overdue_days },
    ] }]);
  }));

  app.get('/api/finance-reports/refunds', staff, h(async (req, res) => {
    const { from, to } = range(req.query);
    const rows = await fin.refunds(from, to, true);
    const f = fmt(req.query);
    if (!f) return res.json({ rows, total: rows.filter((r) => r.status === 'active').reduce((a, r) => a + r.amount, 0) });
    sendExport(res, f, fname('refunds', from, to), [{ name: 'Refunds', rows, columns: [
      { header: 'تاریخ', value: (x: Refund) => x.refund_date_jalali, type: 'text' }, { header: 'کارآموز', value: (x: Refund) => x.student_name },
      { header: 'شناسه ثبت‌نام', value: (x: Refund) => x.enrollment_id }, { header: 'مبلغ', value: (x: Refund) => x.amount },
      { header: 'روش', value: (x: Refund) => PAY_METHOD_FA[x.method] || x.method }, { header: 'علت', value: (x: Refund) => x.reason },
      { header: 'وضعیت', value: (x: Refund) => (x.status === 'void' ? 'باطل' : 'فعال') }, { header: 'ثبت‌کننده', value: (x: Refund) => x.created_by },
    ] }]);
  }));

  app.post('/api/refunds', staff, adminOnly, h(async (req, res) => { res.json(await fin.createRefund(req.body, who(req)?.username || '')); }));
  app.post('/api/refunds/:id/void', staff, adminOnly, h(async (req, res) => { await fin.voidRefund(Number(req.params.id), who(req)?.username || ''); res.json({ ok: true }); }));
  return fin;
}
