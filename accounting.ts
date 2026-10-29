/**
 * Accounting export (خروجی سند حسابداری) with a pluggable adapter interface.
 *
 * The CRM builds balanced journal lines (debit = credit per document) from payments, refunds and (optionally)
 * invoices, and an adapter turns them into a file. What is and is NOT confirmed about vendor formats:
 *  - generic  READY. Clean journal: date, doc no, row, account code/title, detail (tafsili) code/title,
 *             description, debit, credit, reference. CSV (UTF-8 BOM) or Excel 2003 XML.
 *  - holoo    NEEDS CONFIRMATION. Holoo's help documents a list import of accounting documents from an Excel
 *             97-2003 (.xls) file whose columns are matched to Holoo fields by hand in the import form, and the
 *             file/sheet names must be Latin. We emit the generic columns with a Latin sheet name; the user must
 *             "Save As → Excel 97-2003" (our .xls is SpreadsheetML XML, not BIFF8) and map the columns once.
 *  - sepidar  NEEDS CONFIRMATION. Sepidar imports documents via "الگوی دریافت سند حسابداری"; the exact
 *             template must be exported from the user's own Sepidar ("الگوی ارسال سند حسابداری") and accounts /
 *             detail accounts must already exist there. Until we have that sample file the generic layout is used.
 *  - mahak    STUB. Mahak's public help only documents Excel import of base data (people, goods), not journal
 *             documents. Disabled until a documented format/sample is provided.
 *  - moadian  STUB, intentionally NOT implemented: the tax system (سامانه مودیان) needs a tax memory id, the
 *             taxpayer's private key / certificate, signed + encrypted invoice packets and its own API. Out of scope.
 * No vendor API is called; nothing is sent anywhere — exports are files downloaded by an admin.
 */
import type express from 'express';
import { parseFormat, sendExport, type Column, type ExportFormat, type Sheet } from './exporters';
import { jalaliKey, type Invoice } from './invoices';
import { PAY_METHOD_FA, type Refund } from './financeReports';

export type AccountKey = 'cash' | 'bank' | 'pos' | 'online' | 'receivable' | 'revenue' | 'vat_payable' | 'refunds';
export type AccountingSettings = {
  accounts: Record<AccountKey, string>;
  /** cash = payments are revenue when received (default); invoice = issued invoices are revenue + VAT, payments settle receivables. */
  basis: 'cash' | 'invoice';
  doc_description: string;
};
export const ACCOUNT_TITLES: Record<AccountKey, string> = {
  cash: 'صندوق', bank: 'بانک', pos: 'کارتخوان (بانک)', online: 'درگاه پرداخت آنلاین', receivable: 'حساب‌های دریافتنی (کارآموزان)',
  revenue: 'درآمد شهریه آموزش', vat_payable: 'مالیات و عوارض ارزش افزوده پرداختنی', refunds: 'برگشت از درآمد / بازپرداخت شهریه',
};
export const DEFAULT_ACCOUNTING: AccountingSettings = {
  accounts: { cash: '1101', bank: '1102', pos: '1103', online: '1104', receivable: '1301', revenue: '6101', vat_payable: '2201', refunds: '6102' },
  basis: 'cash',
  doc_description: 'سند خودکار درآمد آموزشگاه (CRM)',
};

export type JournalLine = {
  date: string; doc_no: string; row: number; account_code: string; account_title: string;
  detail_code: string; detail_title: string; description: string; debit: number; credit: number; reference: string;
};

export interface AccountingAdapter {
  id: string;
  label: string;
  formats: ExportFormat[];
  status: 'ready' | 'needs_confirmation' | 'stub';
  notes: string;
  /** Turns balanced journal lines into sheets (first sheet is used for CSV). Stubs throw. */
  build(lines: JournalLine[]): Sheet<JournalLine>[];
}

const genericColumns: Column<JournalLine>[] = [
  { header: 'تاریخ سند', value: (l) => l.date, type: 'text' },
  { header: 'شماره سند', value: (l) => l.doc_no, type: 'text' },
  { header: 'ردیف', value: (l) => l.row },
  { header: 'کد حساب', value: (l) => l.account_code, type: 'text' },
  { header: 'عنوان حساب', value: (l) => l.account_title },
  { header: 'کد تفصیلی', value: (l) => l.detail_code, type: 'text' },
  { header: 'عنوان تفصیلی', value: (l) => l.detail_title },
  { header: 'شرح', value: (l) => l.description },
  { header: 'بدهکار', value: (l) => l.debit },
  { header: 'بستانکار', value: (l) => l.credit },
  { header: 'مرجع', value: (l) => l.reference, type: 'text' },
];
const notImplemented = (what: string) => () => { throw Object.assign(new Error(`${what} پیاده‌سازی نشده است.`), { status: 501 }); };

export const ADAPTERS: AccountingAdapter[] = [
  { id: 'generic', label: 'سند عمومی (CSV / اکسل)', formats: ['csv', 'xls'], status: 'ready',
    notes: 'ستون‌ها: تاریخ، شماره سند، ردیف، کد حساب، عنوان حساب، کد/عنوان تفصیلی، شرح، بدهکار، بستانکار، مرجع. هر سند تراز است.',
    build: (lines) => [{ name: 'Journal', rows: lines, columns: genericColumns }] },
  { id: 'holoo', label: 'هلو (ورود لیستی سند از اکسل)', formats: ['xls'], status: 'needs_confirmation',
    notes: 'طبق راهنمای هلو، فایل باید Excel 97-2003 با نام فایل و نام شیت لاتین باشد و ستون‌ها در فرم ورود تطبیق داده شوند. فایل را در اکسل باز کرده و با «Save As → Excel 97-2003» ذخیره کنید. نیاز به آزمایش با نسخهٔ هلوی آموزشگاه.',
    build: (lines) => [{ name: 'Sanad', rows: lines, columns: genericColumns }] },
  { id: 'sepidar', label: 'سپیدار (الگوی دریافت سند)', formats: ['xls', 'csv'], status: 'needs_confirmation',
    notes: 'قالب دقیق «الگوی دریافت سند حسابداری» باید از خود سپیدار آموزشگاه («الگوی ارسال سند حسابداری») گرفته شود؛ حساب‌ها و تفصیلی‌ها باید از قبل در سپیدار تعریف شده باشند. تا دریافت فایل نمونه، ستون‌های عمومی خروجی داده می‌شود.',
    build: (lines) => [{ name: 'Voucher', rows: lines, columns: genericColumns }] },
  { id: 'mahak', label: 'محک', formats: [], status: 'stub',
    notes: 'در راهنمای عمومی محک فقط ورود اطلاعات پایه از اکسل مستند است، نه سند حسابداری. پس از دریافت قالب رسمی فعال می‌شود.',
    build: notImplemented('خروجی محک') },
  { id: 'moadian', label: 'سامانه مودیان (ارسال صورتحساب)', formats: [], status: 'stub',
    notes: 'عمداً پیاده‌سازی نشده: نیازمند شناسه حافظه مالیاتی، کلید خصوصی/گواهی امضا، بستهٔ امضا و رمزنگاری‌شده و API سامانه است. فقط رابط (adapter) برای آینده رزرو شده است.',
    build: notImplemented('ارسال به سامانه مودیان') },
];

export function normalizeAccounting(input: any, base: AccountingSettings = DEFAULT_ACCOUNTING): AccountingSettings {
  const b = input && typeof input === 'object' ? input : {};
  const acc: any = {};
  for (const k of Object.keys(DEFAULT_ACCOUNTING.accounts) as AccountKey[]) {
    const v = String(b.accounts?.[k] ?? base.accounts[k] ?? '').trim().slice(0, 30);
    if (!/^[0-9A-Za-z./-]*$/.test(v)) throw Object.assign(new Error(`کد حساب «${ACCOUNT_TITLES[k]}» نامعتبر است.`), { status: 400 });
    acc[k] = v;
  }
  return {
    accounts: acc,
    basis: b.basis === 'invoice' || b.basis === 'cash' ? b.basis : base.basis,
    doc_description: String(b.doc_description ?? base.doc_description).trim().slice(0, 200),
  };
}

const methodAccount = (m: string): AccountKey => (m === 'cash' ? 'cash' : m === 'pos' ? 'pos' : m === 'online' ? 'online' : 'bank');

/**
 * One balanced document per Jalali day ("CRM-yyyymmdd"). Lines carry the student as the detail account
 * (S<id>), so the accounting software can post per trainee.
 */
export function buildJournal(input: {
  settings: AccountingSettings; payments: any[]; refunds: Refund[]; invoices: Invoice[];
  studentName: (id: number) => string; from: string | null; to: string | null;
}): JournalLine[] {
  const { settings: s } = input;
  const inRange = (d: string | null) => !!d && (!input.from || d >= input.from) && (!input.to || d <= input.to);
  type Raw = Omit<JournalLine, 'row' | 'doc_no' | 'account_title'> & { key: AccountKey };
  const raw: Raw[] = [];
  const line = (date: string, key: AccountKey, studentId: number | null, description: string, debit: number, credit: number, reference: string) =>
    raw.push({ date, key, account_code: s.accounts[key], detail_code: studentId ? `S${studentId}` : '', detail_title: studentId ? input.studentName(studentId) : '', description, debit, credit, reference });

  for (const p of input.payments) {
    const d = jalaliKey(p.pay_date_jalali);
    const amount = Math.round(Number(p.amount || 0));
    if (!inRange(d) || amount <= 0) continue;
    const sid = Number(p.student_id);
    const desc = `دریافت شهریه (${PAY_METHOD_FA[p.pay_method] || p.pay_method || '-'})${p.description ? ` - ${String(p.description).slice(0, 80)}` : ''}`;
    line(d!, methodAccount(String(p.pay_method)), sid, desc, amount, 0, `PAY-${p.id}`);
    line(d!, s.basis === 'invoice' ? 'receivable' : 'revenue', sid, desc, 0, amount, `PAY-${p.id}`);
  }
  for (const r of input.refunds) {
    const d = jalaliKey(r.refund_date_jalali);
    if (r.status !== 'active' || !inRange(d)) continue;
    const desc = `بازپرداخت شهریه - ${r.reason}`.slice(0, 200);
    line(d!, 'refunds', r.student_id, desc, r.amount, 0, `REF-${r.id}`);
    line(d!, methodAccount(r.method), r.student_id, desc, 0, r.amount, `REF-${r.id}`);
  }
  if (s.basis === 'invoice') {
    for (const inv of input.invoices) {
      const d = jalaliKey(inv.issue_date_jalali);
      if (inv.status !== 'issued' || !inRange(d)) continue;
      const desc = `فاکتور ${inv.invoice_no} - ${inv.buyer?.full_name || ''}`;
      line(d!, 'receivable', inv.student_id, desc, inv.grand_total, 0, inv.invoice_no);
      line(d!, 'revenue', inv.student_id, desc, 0, inv.grand_total - inv.tax_total, inv.invoice_no);
      if (inv.tax_total > 0) line(d!, 'vat_payable', inv.student_id, desc, 0, inv.tax_total, inv.invoice_no);
    }
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  const out: JournalLine[] = [];
  const rowByDoc = new Map<string, number>();
  for (const r of raw) {
    const doc = `CRM-${r.date.replace(/\//g, '')}`;
    const row = (rowByDoc.get(doc) || 0) + 1;
    rowByDoc.set(doc, row);
    const { key, ...rest } = r;
    out.push({ ...rest, doc_no: doc, row, account_title: ACCOUNT_TITLES[key], description: rest.description || s.doc_description });
  }
  return out;
}

export function registerAccounting(app: express.Express, deps: {
  session: (req: express.Request) => { username: string; role: string } | null;
  readJsonDb: () => any; writeJsonDb: (s: any) => void;
  loadPayments: () => Promise<any[]>; loadStudents: () => Promise<any[]>;
  refunds: (from: string | null, to: string | null) => Promise<Refund[]>;
  invoices: (from: string | null, to: string | null) => Promise<Invoice[]>;
  log: (m: string) => void;
}) {
  const admin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const s = deps.session(req);
    if (!s) return res.status(401).json({ error: 'Unauthorized' });
    if (s.role !== 'admin') return res.status(403).json({ error: 'فقط مدیر سیستم' });
    next();
  };
  const getSettings = () => normalizeAccounting(deps.readJsonDb()?.settings?.accounting || {});
  const fail = (res: express.Response, e: any) => {
    if (!e?.status || e.status >= 500) deps.log(`accounting: ${e?.message || e}`);
    res.status(e?.status || 500).json({ error: e?.status && e.status < 500 || e?.status === 501 ? e.message : 'خطای داخلی سرور' });
  };

  app.get('/api/accounting/adapters', admin, (_req, res) => {
    res.json(ADAPTERS.map(({ build, ...a }) => a));
  });
  app.get('/api/accounting/settings', admin, (_req, res) => { res.json(getSettings()); });
  app.put('/api/accounting/settings', admin, (req, res) => {
    try {
      const next = normalizeAccounting(req.body, getSettings());
      const store = deps.readJsonDb();
      store.settings = { ...(store.settings || {}), accounting: next };
      deps.writeJsonDb(store);
      res.json(next);
    } catch (e) { fail(res, e); }
  });
  app.get('/api/accounting/export', admin, async (req, res) => {
    try {
      const adapter = ADAPTERS.find((a) => a.id === String(req.query.adapter || 'generic'));
      if (!adapter) throw Object.assign(new Error('نوع خروجی نامعتبر است.'), { status: 400 });
      if (adapter.status === 'stub') throw Object.assign(new Error(`${adapter.label}: ${adapter.notes}`), { status: 501 });
      const format = parseFormat(req.query.format) || adapter.formats[0];
      if (!adapter.formats.includes(format)) throw Object.assign(new Error('این فرمت برای این نرم‌افزار پشتیبانی نمی‌شود.'), { status: 400 });
      const from = req.query.from ? jalaliKey(req.query.from) : null; const to = req.query.to ? jalaliKey(req.query.to) : null;
      if ((req.query.from && !from) || (req.query.to && !to)) throw Object.assign(new Error('تاریخ نامعتبر است.'), { status: 400 });
      const settings = getSettings();
      const students = new Map((await deps.loadStudents()).map((s) => [Number(s.id), `${s.first_name || ''} ${s.last_name || ''}`.trim()]));
      const lines = buildJournal({
        settings, payments: await deps.loadPayments(), refunds: await deps.refunds(from, to),
        invoices: settings.basis === 'invoice' ? await deps.invoices(from, to) : [],
        studentName: (id) => students.get(id) || '', from, to,
      });
      // Latin file name (Holoo requires it); dates without slashes.
      sendExport(res, format, `journal-${adapter.id}-${(from || 'start').replace(/\//g, '')}-${(to || 'now').replace(/\//g, '')}`, adapter.build(lines));
    } catch (e) { fail(res, e); }
  });
}
