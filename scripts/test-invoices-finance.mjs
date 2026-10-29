// Unit checks for invoices / finance reports / accounting export helpers (no server, no DB).
// Run: node --import tsx scripts/test-invoices-finance.mjs
import assert from 'node:assert/strict';
import { computeItems, parseItems, formatInvoiceNo, jalaliKey, normalizeSettings, defaultInvoiceSettings } from '../invoices.ts';
import { agingBucket } from '../financeReports.ts';
import { buildJournal, DEFAULT_ACCOUNTING, normalizeAccounting, ADAPTERS } from '../accounting.ts';
import { toCsv, toSpreadsheetXml } from '../exporters.ts';

// Numbering and dates
assert.equal(formatInvoiceNo('INV-', '1405', 7), 'INV-1405-00007');
assert.equal(jalaliKey('۱۴۰۵/۸/۷'), '1405/08/07');
assert.equal(jalaliKey('1405-08-07'), '1405/08/07');
assert.equal(jalaliKey('nope'), null);

// VAT math
const items = parseItems([{ description: 'دوره', quantity: 2, unit_price: '1,000,000', discount: 200000 }]);
let c = computeItems(items, { vat_enabled: false, vat_rate: 10, price_includes_vat: false });
assert.deepEqual([c.subtotal, c.discount_total, c.tax_total, c.grand_total], [2000000, 200000, 0, 1800000]);
c = computeItems(items, { vat_enabled: true, vat_rate: 10, price_includes_vat: false });
assert.deepEqual([c.tax_total, c.grand_total], [180000, 1980000]);
c = computeItems(items, { vat_enabled: true, vat_rate: 10, price_includes_vat: true });
assert.equal(c.grand_total, 1800000);
assert.equal(c.items[0].net + c.tax_total, 1800000);
assert.throws(() => parseItems([]));
assert.throws(() => parseItems([{ description: 'x', quantity: 1, unit_price: 10, discount: 11 }]));

// Settings defaults: VAT off, seller from academy settings
const base = defaultInvoiceSettings({ academy_name: 'آموزشگاه نمونه' });
assert.equal(base.vat_enabled, false);
assert.equal(base.seller.legal_name, 'آموزشگاه نمونه');
assert.throws(() => normalizeSettings({ vat_rate: 500 }, base));

// Aging buckets
assert.equal(agingBucket(0), '0_30');
assert.equal(agingBucket(45), '31_60');
assert.equal(agingBucket(400), '180_plus');

// Journal: every document balances; refunds and invoice basis included
const payments = [
  { id: 1, student_id: 5, amount: 1000000, pay_method: 'pos', pay_date_jalali: '1405/08/01' },
  { id: 2, student_id: 6, amount: 500000, pay_method: 'cash', pay_date_jalali: '1405/08/01' },
  { id: 3, student_id: 6, amount: 700000, pay_method: 'online', pay_date_jalali: '1405/07/30' },
];
const refunds = [{ id: 1, student_id: 6, enrollment_id: null, amount: 100000, refund_date_jalali: '1405/08/02', method: 'cash', reason: 'انصراف', status: 'active' }];
const invoices = [{ id: 1, invoice_no: 'INV-1405-00001', student_id: 5, issue_date_jalali: '1405/08/01', status: 'issued', grand_total: 1100000, tax_total: 100000, buyer: { full_name: 'x' } }];
for (const basis of ['cash', 'invoice']) {
  const lines = buildJournal({ settings: { ...DEFAULT_ACCOUNTING, basis }, payments, refunds, invoices, studentName: (id) => `S${id}`, from: '1405/08/01', to: '1405/08/30' });
  const docs = new Map();
  for (const l of lines) { const d = docs.get(l.doc_no) || [0, 0]; d[0] += l.debit; d[1] += l.credit; docs.set(l.doc_no, d); }
  for (const [doc, [dr, cr]] of docs) assert.equal(dr, cr, `${basis} ${doc} balanced`);
  assert.equal(lines.some((l) => l.reference === 'PAY-3'), false, 'out of range payment excluded');
  assert.equal(lines.some((l) => l.reference === 'INV-1405-00001'), basis === 'invoice');
}
assert.equal(normalizeAccounting({ basis: 'weird' }).basis, 'cash');
assert.ok(ADAPTERS.find((a) => a.id === 'generic' && a.status === 'ready'));
assert.ok(ADAPTERS.find((a) => a.id === 'moadian' && a.status === 'stub'));

// Exports: BOM + CRLF, formula injection neutralised, XML escaped
const csv = toCsv([{ a: '=SUM(A1)', b: 12 }, { a: 'x,"y"', b: 3 }], [{ header: 'A', value: (r) => r.a }, { header: 'B', value: (r) => r.b, type: 'number' }]);
assert.ok(csv.startsWith('\uFEFF'));
assert.ok(csv.includes('\r\n'));
assert.ok(!/(^|,)=SUM/m.test(csv.replace('\uFEFF', '')), 'formula guarded');
assert.ok(csv.includes('"x,""y"""'));
const xml = toSpreadsheetXml([{ name: 'Test', rows: [{ a: '<b>&' }], columns: [{ header: 'A', value: (r) => r.a }] }]);
assert.ok(xml.includes('&lt;b&gt;&amp;'));
console.log('invoices-finance helpers: ok');
