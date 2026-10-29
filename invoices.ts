/**
 * Official invoices (فاکتور رسمی / صورتحساب فروش کالا و خدمات).
 *
 * Additive only: new tables crm_invoices, crm_invoice_items, crm_invoice_counters (MySQL) or the
 * "invoices_store" key in db_store.json. Existing tables are only read (students, courses, enrollments).
 * - Numbering: per Jalali year, `${prefix}${yyyy}-${seq:5}`; the counter is advanced atomically with
 *   INSERT … ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1). An invoice is never deleted:
 *   it can only be cancelled (ابطال) with a reason, so the sequence has no holes from deletions.
 * - Seller and buyer data are snapshotted on the invoice (later edits of the student/academy do not change
 *   an issued invoice).
 * - VAT is configurable (off by default — educational services may be exempt; confirm with a tax advisor).
 * - Not implemented on purpose: submission to the Moadian tax system (سامانه مودیان); see accounting.ts.
 * Routes: /api/invoices (admin + cashier; settings + cancel are admin only).
 */
import type express from 'express';
import * as db from './mysql-socks';
import { parseFormat, sendExport, type Column } from './exporters';

export type Seller = { legal_name: string; economic_code: string; national_id: string; registration_no: string; postal_code: string; address: string; phone: string };
export type Buyer = { full_name: string; national_code: string; phone: string; address: string; father_name: string };
export type InvoiceSettings = { seller: Seller; prefix: string; vat_enabled: boolean; vat_rate: number; price_includes_vat: boolean; default_notes: string; footer_text: string };
export type InvoiceItemInput = { description: string; quantity: number; unit_price: number; discount: number };
export type InvoiceItem = InvoiceItemInput & { id?: number; net: number; tax_rate: number; tax_amount: number; total: number };
export type Invoice = {
  id: number; invoice_no: string; issue_date_jalali: string; status: 'issued' | 'cancelled'; student_id: number; enrollment_id: number | null;
  seller: Seller; buyer: Buyer; items: InvoiceItem[]; subtotal: number; discount_total: number; tax_total: number; grand_total: number;
  notes: string | null; created_by: string | null; created_at: string; cancelled_at: string | null; cancel_reason: string | null;
  footer_text?: string;
};

export type InvoiceDeps = {
  session: (req: express.Request) => { username: string; role: string } | null;
  readJsonDb: () => any;
  writeJsonDb: (s: any) => void;
  loadStudents: () => Promise<any[]>;
  loadCourses: () => Promise<any[]>;
  loadEnrollments: () => Promise<any[]>;
  jalaliToday: () => string;
  log: (m: string) => void;
};

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const toEn = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const int = (v: unknown) => { const n = Number(toEn(v).replace(/[,٬\s]/g, '')); return Number.isFinite(n) ? Math.round(n) : NaN; };
export const jalaliKey = (v: unknown): string | null => {
  const m = toEn(v).trim().replace(/-/g, '/').match(/^(1[34]\d\d)\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
};
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

const EMPTY_SELLER: Seller = { legal_name: '', economic_code: '', national_id: '', registration_no: '', postal_code: '', address: '', phone: '' };

export function defaultInvoiceSettings(academy: any): InvoiceSettings {
  return {
    seller: { ...EMPTY_SELLER, legal_name: str(academy?.academy_name, 200), address: str(academy?.address, 400), phone: str(academy?.phone_number, 40) },
    prefix: '', vat_enabled: false, vat_rate: 10, price_includes_vat: false, default_notes: '', footer_text: '',
  };
}

export function normalizeSettings(input: any, base: InvoiceSettings): InvoiceSettings {
  const b = input && typeof input === 'object' ? input : {};
  const s = b.seller && typeof b.seller === 'object' ? b.seller : {};
  const digits = (v: unknown, max: number) => toEn(v).replace(/\D/g, '').slice(0, max);
  const rate = Number(b.vat_rate ?? base.vat_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw httpError(400, 'نرخ مالیات باید بین ۰ و ۱۰۰ باشد.');
  const prefix = str(b.prefix ?? base.prefix, 12);
  if (prefix && !/^[0-9A-Za-z_-]+$/.test(prefix)) throw httpError(400, 'پیشوند شماره فاکتور فقط حروف لاتین، عدد، - و _ باشد.');
  return {
    seller: {
      legal_name: str(s.legal_name ?? base.seller.legal_name, 200),
      economic_code: digits(s.economic_code ?? base.seller.economic_code, 14),
      national_id: digits(s.national_id ?? base.seller.national_id, 11),
      registration_no: str(s.registration_no ?? base.seller.registration_no, 40),
      postal_code: digits(s.postal_code ?? base.seller.postal_code, 10),
      address: str(s.address ?? base.seller.address, 400),
      phone: str(s.phone ?? base.seller.phone, 40),
    },
    prefix,
    vat_enabled: b.vat_enabled === undefined ? base.vat_enabled : !!b.vat_enabled,
    vat_rate: Math.round(rate * 100) / 100,
    price_includes_vat: b.price_includes_vat === undefined ? base.price_includes_vat : !!b.price_includes_vat,
    default_notes: str(b.default_notes ?? base.default_notes, 1000),
    footer_text: str(b.footer_text ?? base.footer_text, 1000),
  };
}

/** Line math (Toman, integers). With VAT included in the price, the tax is extracted from the net amount. */
export function computeItems(items: InvoiceItemInput[], s: Pick<InvoiceSettings, 'vat_enabled' | 'vat_rate' | 'price_includes_vat'>) {
  const rate = s.vat_enabled ? s.vat_rate : 0;
  const out: InvoiceItem[] = items.map((it) => {
    const gross = it.quantity * it.unit_price;
    const afterDiscount = gross - it.discount;
    let net = afterDiscount; let tax = 0;
    if (rate > 0) {
      if (s.price_includes_vat) { tax = Math.round((afterDiscount * rate) / (100 + rate)); net = afterDiscount - tax; }
      else tax = Math.round((afterDiscount * rate) / 100);
    }
    return { ...it, net, tax_rate: rate, tax_amount: tax, total: net + tax };
  });
  const subtotal = out.reduce((a, i) => a + i.quantity * i.unit_price, 0);
  const discount_total = out.reduce((a, i) => a + i.discount, 0);
  const tax_total = out.reduce((a, i) => a + i.tax_amount, 0);
  const grand_total = out.reduce((a, i) => a + i.total, 0);
  return { items: out, subtotal, discount_total, tax_total, grand_total };
}

export function parseItems(raw: unknown): InvoiceItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw httpError(400, 'حداقل یک ردیف کالا/خدمت لازم است.');
  if (raw.length > 50) throw httpError(400, 'حداکثر ۵۰ ردیف مجاز است.');
  return raw.map((r: any, i) => {
    const description = str(r?.description, 300);
    const quantity = int(r?.quantity ?? 1);
    const unit_price = int(r?.unit_price);
    const discount = int(r?.discount ?? 0);
    const row = `ردیف ${i + 1}: `;
    if (!description) throw httpError(400, `${row}شرح الزامی است.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw httpError(400, `${row}تعداد نامعتبر است.`);
    if (!Number.isInteger(unit_price) || unit_price < 0 || unit_price > 1e12) throw httpError(400, `${row}مبلغ واحد نامعتبر است.`);
    if (!Number.isInteger(discount) || discount < 0 || discount > quantity * unit_price) throw httpError(400, `${row}تخفیف نامعتبر است.`);
    return { description, quantity, unit_price, discount };
  });
}

export const formatInvoiceNo = (prefix: string, year: string, seq: number) => `${prefix}${year}-${String(seq).padStart(5, '0')}`;

export async function ensureInvoicesSchema(): Promise<void> {
  if (!db.isMysqlEnabled()) return;
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_invoice_counters (
    year CHAR(4) NOT NULL PRIMARY KEY COMMENT 'Jalali year',
    last_seq INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: invoice number sequence per Jalali year'`);
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_invoices (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_no VARCHAR(32) NOT NULL,
    serial_year CHAR(4) NOT NULL,
    serial_seq INT UNSIGNED NOT NULL,
    issue_date_jalali CHAR(10) NOT NULL,
    student_id INT NOT NULL,
    enrollment_id INT NULL,
    seller_json JSON NOT NULL COMMENT 'seller snapshot at issue time',
    buyer_json JSON NOT NULL COMMENT 'buyer snapshot at issue time',
    subtotal BIGINT NOT NULL DEFAULT 0 COMMENT 'Toman',
    discount_total BIGINT NOT NULL DEFAULT 0,
    tax_total BIGINT NOT NULL DEFAULT 0,
    grand_total BIGINT NOT NULL DEFAULT 0,
    status ENUM('issued','cancelled') NOT NULL DEFAULT 'issued',
    notes TEXT NULL,
    created_by VARCHAR(80) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at DATETIME NULL,
    cancelled_by VARCHAR(80) NULL,
    cancel_reason VARCHAR(300) NULL,
    UNIQUE KEY uq_invoice_no (invoice_no),
    UNIQUE KEY uq_invoice_serial (serial_year, serial_seq),
    KEY idx_invoice_date (issue_date_jalali),
    KEY idx_invoice_student (student_id),
    KEY idx_invoice_enrollment (enrollment_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: official invoices / فاکتور رسمی'`);
  await db.sqlExec(`CREATE TABLE IF NOT EXISTS crm_invoice_items (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT UNSIGNED NOT NULL,
    line_no INT NOT NULL,
    description VARCHAR(300) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price BIGINT NOT NULL,
    discount BIGINT NOT NULL DEFAULT 0,
    net BIGINT NOT NULL,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
    tax_amount BIGINT NOT NULL DEFAULT 0,
    total BIGINT NOT NULL,
    KEY idx_item_invoice (invoice_id),
    CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES crm_invoices (id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM: invoice lines / ردیف‌های فاکتور'`);
}

const parseJson = (v: any) => { if (v && typeof v === 'object') return v; try { return JSON.parse(String(v || '{}')); } catch { return {}; } };

function rowToInvoice(r: any, items: any[]): Invoice {
  return {
    id: Number(r.id), invoice_no: r.invoice_no, issue_date_jalali: r.issue_date_jalali, status: r.status,
    student_id: Number(r.student_id), enrollment_id: r.enrollment_id === null || r.enrollment_id === undefined ? null : Number(r.enrollment_id),
    seller: { ...EMPTY_SELLER, ...parseJson(r.seller_json ?? r.seller) }, buyer: parseJson(r.buyer_json ?? r.buyer) as Buyer,
    items: items.map((i) => ({
      id: i.id === undefined ? undefined : Number(i.id), description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      discount: Number(i.discount), net: Number(i.net), tax_rate: Number(i.tax_rate), tax_amount: Number(i.tax_amount), total: Number(i.total),
    })),
    subtotal: Number(r.subtotal), discount_total: Number(r.discount_total), tax_total: Number(r.tax_total), grand_total: Number(r.grand_total),
    notes: r.notes ?? null, created_by: r.created_by ?? null, created_at: iso(r.created_at) || '', cancelled_at: iso(r.cancelled_at), cancel_reason: r.cancel_reason ?? null,
  };
}

export function registerInvoices(app: express.Express, deps: InvoiceDeps) {
  const jsonState = () => {
    const store = deps.readJsonDb();
    const inv = (store.invoices_store = store.invoices_store || {});
    inv.counters = inv.counters || {};
    inv.list = Array.isArray(inv.list) ? inv.list : [];
    return { store, inv };
  };
  const getSettings = (): InvoiceSettings => {
    const st = deps.readJsonDb()?.settings || {};
    const base = defaultInvoiceSettings(st);
    return st.invoice ? normalizeSettings(st.invoice, base) : base;
  };

  async function nextNumber(year: string): Promise<number> {
    if (db.isMysqlEnabled()) {
      const r = await db.sqlExec(
        'INSERT INTO crm_invoice_counters (year, last_seq) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)', [year]);
      if (!r.insertId) throw httpError(500, 'شماره فاکتور تولید نشد.');
      return Number(r.insertId);
    }
    const { store, inv } = jsonState();
    const seq = (Number(inv.counters[year]) || 0) + 1;
    inv.counters[year] = seq;
    deps.writeJsonDb(store);
    return seq;
  }

  async function list(filter: { from?: string | null; to?: string | null; status?: string; q?: string; student_id?: number | null }): Promise<Invoice[]> {
    let rows: Invoice[];
    if (db.isMysqlEnabled()) {
      const where: string[] = []; const params: any[] = [];
      if (filter.from) { where.push('issue_date_jalali >= ?'); params.push(filter.from); }
      if (filter.to) { where.push('issue_date_jalali <= ?'); params.push(filter.to); }
      if (filter.status === 'issued' || filter.status === 'cancelled') { where.push('status = ?'); params.push(filter.status); }
      if (filter.student_id) { where.push('student_id = ?'); params.push(filter.student_id); }
      rows = (await db.sql<any>(`SELECT * FROM crm_invoices ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 2000`, params)).map((r) => rowToInvoice(r, []));
    } else {
      rows = jsonState().inv.list.slice().reverse().map((r: any) => rowToInvoice(r, []))
        .filter((r: Invoice) => (!filter.from || r.issue_date_jalali >= filter.from) && (!filter.to || r.issue_date_jalali <= filter.to)
          && (!filter.status || filter.status === 'all' || r.status === filter.status) && (!filter.student_id || r.student_id === filter.student_id));
    }
    const q = toEn(filter.q || '').trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.invoice_no.toLowerCase().includes(q) || String(r.buyer?.full_name || '').toLowerCase().includes(q) || toEn(r.buyer?.national_code || '').includes(q));
    return rows;
  }

  async function get(id: number): Promise<Invoice | null> {
    if (db.isMysqlEnabled()) {
      const r = (await db.sql<any>('SELECT * FROM crm_invoices WHERE id = ?', [id]))[0];
      if (!r) return null;
      return rowToInvoice(r, await db.sql<any>('SELECT * FROM crm_invoice_items WHERE invoice_id = ? ORDER BY line_no', [id]));
    }
    const r = jsonState().inv.list.find((x: any) => Number(x.id) === id);
    return r ? rowToInvoice(r, r.items || []) : null;
  }

  async function buildDraft(enrollmentId: number) {
    const enrollment = (await deps.loadEnrollments()).find((e) => Number(e.id) === enrollmentId);
    if (!enrollment) throw httpError(404, 'ثبت‌نام پیدا نشد.');
    const student = (await deps.loadStudents()).find((s) => Number(s.id) === Number(enrollment.student_id));
    if (!student) throw httpError(404, 'کارآموز پیدا نشد.');
    const course = (await deps.loadCourses()).find((c) => Number(c.id) === Number(enrollment.course_id));
    const finalPrice = Math.max(Math.round(Number(enrollment.final_price) || 0), 0);
    const listPrice = Math.max(Math.round(Number(course?.price ?? course?.tuition ?? 0) || 0), 0);
    const unit = listPrice > finalPrice ? listPrice : finalPrice;
    const title = `شهریه دوره ${course?.title || `#${enrollment.course_id}`}${enrollment.course_number ? ` (کلاس ${enrollment.course_number})` : ''}`;
    return {
      student_id: Number(student.id), enrollment_id: enrollmentId, issue_date_jalali: deps.jalaliToday(),
      buyer: buyerOf(student),
      items: [{ description: title, quantity: 1, unit_price: unit, discount: unit - finalPrice }],
    };
  }
  const buyerOf = (s: any): Buyer => ({
    full_name: `${s.first_name || ''} ${s.last_name || ''}`.trim(), national_code: String(s.national_code || ''),
    phone: String(s.phone_number || ''), address: String(s.address || ''), father_name: String(s.father_name || ''),
  });

  async function create(input: any, username: string): Promise<Invoice> {
    const studentId = Number(input?.student_id);
    if (!Number.isInteger(studentId) || studentId <= 0) throw httpError(400, 'کارآموز مشخص نیست.');
    const student = (await deps.loadStudents()).find((s) => Number(s.id) === studentId);
    if (!student) throw httpError(404, 'کارآموز پیدا نشد.');
    let enrollmentId: number | null = null;
    if (input?.enrollment_id !== undefined && input?.enrollment_id !== null && input?.enrollment_id !== '') {
      enrollmentId = Number(input.enrollment_id);
      const e = (await deps.loadEnrollments()).find((x) => Number(x.id) === enrollmentId);
      if (!e || Number(e.student_id) !== studentId) throw httpError(400, 'ثبت‌نام متعلق به این کارآموز نیست.');
    }
    const issue = input?.issue_date_jalali ? jalaliKey(input.issue_date_jalali) : jalaliKey(deps.jalaliToday());
    if (!issue) throw httpError(400, 'تاریخ فاکتور نامعتبر است.');
    const settings = getSettings();
    if (!settings.seller.legal_name) throw httpError(400, 'ابتدا مشخصات فروشنده را در تنظیمات فاکتور کامل کنید.');
    const buyer = buyerOf(student);
    if (!buyer.national_code) throw httpError(400, 'کد ملی خریدار ثبت نشده است.');
    const calc = computeItems(parseItems(input?.items), settings);
    if (calc.grand_total <= 0) throw httpError(400, 'مبلغ فاکتور باید بیشتر از صفر باشد.');
    const notes = str(input?.notes ?? settings.default_notes, 1000) || null;
    const year = issue.slice(0, 4);
    const seq = await nextNumber(year);
    const invoiceNo = formatInvoiceNo(settings.prefix, year, seq);

    if (db.isMysqlEnabled()) {
      const r = await db.sqlExec(
        `INSERT INTO crm_invoices (invoice_no, serial_year, serial_seq, issue_date_jalali, student_id, enrollment_id, seller_json, buyer_json,
           subtotal, discount_total, tax_total, grand_total, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
        [invoiceNo, year, seq, issue, studentId, enrollmentId, JSON.stringify(settings.seller), JSON.stringify(buyer),
          calc.subtotal, calc.discount_total, calc.tax_total, calc.grand_total, notes, username || null]);
      try {
        let line = 0;
        for (const it of calc.items) {
          line += 1;
          await db.sqlExec(
            `INSERT INTO crm_invoice_items (invoice_id, line_no, description, quantity, unit_price, discount, net, tax_rate, tax_amount, total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.insertId, line, it.description, it.quantity, it.unit_price, it.discount, it.net, it.tax_rate, it.tax_amount, it.total]);
        }
      } catch (e) {
        // Keep the number (no holes): an invoice whose lines failed is cancelled, never deleted.
        await db.sqlExec("UPDATE crm_invoices SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?", ['خطای ثبت ردیف‌ها (خودکار)', r.insertId]);
        throw e;
      }
      return (await get(r.insertId))!;
    }
    const { store, inv } = jsonState();
    const id = inv.list.reduce((m: number, x: any) => Math.max(m, Number(x.id) || 0), 0) + 1;
    inv.list.push({
      id, invoice_no: invoiceNo, serial_year: year, serial_seq: seq, issue_date_jalali: issue, student_id: studentId, enrollment_id: enrollmentId,
      seller: settings.seller, buyer, items: calc.items.map((it, i) => ({ id: i + 1, ...it })), subtotal: calc.subtotal, discount_total: calc.discount_total,
      tax_total: calc.tax_total, grand_total: calc.grand_total, status: 'issued', notes, created_by: username || null, created_at: new Date().toISOString(),
      cancelled_at: null, cancel_reason: null,
    });
    deps.writeJsonDb(store);
    return (await get(id))!;
  }

  async function cancel(id: number, reason: string, username: string): Promise<Invoice> {
    const inv0 = await get(id);
    if (!inv0) throw httpError(404, 'فاکتور پیدا نشد.');
    if (inv0.status === 'cancelled') throw httpError(409, 'این فاکتور قبلاً باطل شده است.');
    if (!reason) throw httpError(400, 'علت ابطال الزامی است.');
    if (db.isMysqlEnabled()) {
      await db.sqlExec("UPDATE crm_invoices SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ? WHERE id = ? AND status = 'issued'", [username || null, reason, id]);
    } else {
      const { store, inv } = jsonState();
      const r = inv.list.find((x: any) => Number(x.id) === id);
      Object.assign(r, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: username || null, cancel_reason: reason });
      deps.writeJsonDb(store);
    }
    deps.log(`invoice ${inv0.invoice_no} cancelled by ${username}`);
    return (await get(id))!;
  }

  // ── routes ──────────────────────────────────────────────────────────────
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
      if (!e?.status || e.status >= 500) deps.log(`invoices: ${e?.message || e}`);
      res.status(e?.status || 500).json({ error: e?.status && e.status < 500 ? e.message : 'خطای داخلی سرور' });
    });
  };
  const filterOf = (q: any) => ({
    from: q.from ? jalaliKey(q.from) : null, to: q.to ? jalaliKey(q.to) : null,
    status: str(q.status, 20), q: str(q.q, 80), student_id: Number(q.student_id) || null,
  });

  app.get('/api/invoices/settings', staff, (_req, res) => { res.json(getSettings()); });
  app.put('/api/invoices/settings', staff, adminOnly, h(async (req, res) => {
    const next = normalizeSettings(req.body, getSettings());
    const store = deps.readJsonDb();
    store.settings = { ...(store.settings || {}), invoice: next };
    deps.writeJsonDb(store);
    res.json(next);
  }));
  app.get('/api/invoices/export', staff, h(async (req, res) => {
    const format = parseFormat(req.query.format);
    if (!format) throw httpError(400, 'فرمت خروجی باید csv یا xls باشد.');
    const rows = await list(filterOf(req.query));
    const cols: Column<Invoice>[] = [
      { header: 'شماره فاکتور', value: (r) => r.invoice_no, type: 'text' },
      { header: 'تاریخ', value: (r) => r.issue_date_jalali, type: 'text' },
      { header: 'خریدار', value: (r) => r.buyer?.full_name },
      { header: 'کد ملی خریدار', value: (r) => r.buyer?.national_code, type: 'text' },
      { header: 'جمع (تومان)', value: (r) => r.subtotal },
      { header: 'تخفیف', value: (r) => r.discount_total },
      { header: 'مالیات', value: (r) => r.tax_total },
      { header: 'مبلغ نهایی', value: (r) => r.grand_total },
      { header: 'وضعیت', value: (r) => (r.status === 'issued' ? 'صادرشده' : 'باطل‌شده') },
      { header: 'علت ابطال', value: (r) => r.cancel_reason },
    ];
    sendExport(res, format, `invoices-${(req.query.from as string) || 'all'}`.replace(/\//g, ''), [{ name: 'Invoices', rows, columns: cols }]);
  }));
  app.get('/api/invoices', staff, h(async (req, res) => { res.json(await list(filterOf(req.query))); }));
  app.post('/api/invoices/draft', staff, h(async (req, res) => {
    const id = Number(req.body?.enrollment_id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'شناسه ثبت‌نام نامعتبر است.');
    res.json(await buildDraft(id));
  }));
  app.get('/api/invoices/:id', staff, h(async (req, res) => {
    const inv = await get(Number(req.params.id));
    if (!inv) throw httpError(404, 'فاکتور پیدا نشد.');
    res.json({ ...inv, footer_text: getSettings().footer_text });
  }));
  app.post('/api/invoices', staff, h(async (req, res) => { res.json(await create(req.body, who(req)?.username || '')); }));
  app.post('/api/invoices/:id/cancel', staff, adminOnly, h(async (req, res) => {
    res.json(await cancel(Number(req.params.id), str(req.body?.reason, 300), who(req)?.username || ''));
  }));

  return { list, get };
}
