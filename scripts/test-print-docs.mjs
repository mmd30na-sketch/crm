#!/usr/bin/env node
/**
 * Offline tests for the registration documents' pure logic (file names, field mapping, receipt number, contract text).
 * Synthetic data only. Run: npm run test:print   (= node --import tsx scripts/test-print-docs.mjs)
 */
import assert from 'node:assert/strict';
import {
  DOC_KINDS, DOC_PATH_FIELDS, parseDocKind, safeSegment, registrationPdfRelPath, downloadFileName, isPdfBytes,
  receiptNumber, formatAmount, toPersianDigits, contractClauses, DEFAULT_CONTRACT_TEXT, paymentSummary, buildDocData, docWarnings,
} from '../src/utils/printDocs.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('kinds and enrollment columns', () => {
  assert.deepEqual([...DOC_KINDS], ['Receipt', 'IDCard', 'Contract']);
  assert.equal(DOC_PATH_FIELDS.Receipt, 'receipt_pdf_path');
  assert.equal(DOC_PATH_FIELDS.IDCard, 'idcard_pdf_path');
  assert.equal(DOC_PATH_FIELDS.Contract, 'contract_pdf_path');
  assert.equal(parseDocKind('idcard'), 'IDCard');
  assert.equal(parseDocKind(' Contract '), 'Contract');
  assert.equal(parseDocKind('../x'), null);
  assert.equal(parseDocKind(undefined), null);
});

test('safeSegment never yields traversal or empty names', () => {
  assert.equal(safeSegment('..', 'x'), 'x');
  assert.equal(safeSegment('', 'unsorted'), 'unsorted');
  assert.equal(safeSegment('a/b\\c', 'x'), 'a_b_c');
  assert.equal(safeSegment('محمدی', 'x'), 'محمدی');
  assert.equal(safeSegment('x'.repeat(200), 'f').length, 80);
});

test('registration PDF path: course folder / LastName_id / LastName_id_Kind.pdf', () => {
  const p = registrationPdfRelPath({ courseNumber: 118, lastName: 'احمدی', studentId: 42, kind: 'IDCard' });
  assert.equal(p.path, 'StudentFiles/118/احمدی_42/احمدی_42_IDCard.pdf');
  assert.equal(p.dir, 'StudentFiles/118/احمدی_42');
  assert.equal(p.base, 'احمدی_42_IDCard');
  const q = registrationPdfRelPath({ courseNumber: null, lastName: '../../etc', studentId: '7', kind: 'Receipt' });
  assert.ok(!q.path.split('/').some((s) => /^\.+$/.test(s)));
  assert.equal(q.path.split('/').length, 4);
  assert.equal(q.dir.split('/')[1], 'unsorted');
  assert.equal(downloadFileName('Rezaei', 5, 'Contract'), 'Rezaei_5_Contract.pdf');
});

test('PDF magic bytes', () => {
  assert.equal(isPdfBytes(Buffer.from('%PDF-1.4\n')), true);
  assert.equal(isPdfBytes(Buffer.from('<html>')), false);
  assert.equal(isPdfBytes(Buffer.from('%PD')), false);
});

test('receipt number is the enrollment id, same for every document', () => {
  assert.equal(receiptNumber({ id: 57 }), '57');
  assert.equal(receiptNumber({ id: '57' }), '57');
  assert.equal(receiptNumber({ id: 0 }), '');
  assert.equal(receiptNumber(null), '');
  const base = { student: { first_name: 'علی' }, enrollment: { id: 57, course_number: 12, final_price: 100 }, date: '1405/07/18' };
  assert.equal(buildDocData(base).receiptNumber, '57');
  assert.equal(buildDocData(base).courseNumber, '12');
});

test('amount and digit formatting', () => {
  assert.equal(toPersianDigits('1405/07/18'), '۱۴۰۵/۰۷/۱۸');
  assert.equal(formatAmount(1250000), '۱٬۲۵۰٬۰۰۰');
  assert.equal(formatAmount(0), '۰');
  assert.equal(formatAmount(-5), '۰');
  assert.equal(formatAmount(999), '۹۹۹');
});

test('payment summary: settled vs remaining, never negative', () => {
  assert.deepEqual(paymentSummary(1000, 1000), { tuition: 1000, paid: 1000, remaining: 0, settled: true, statusText: 'تسویه کامل' });
  const r = paymentSummary(5000000, 2000000);
  assert.equal(r.settled, false);
  assert.equal(r.remaining, 3000000);
  assert.equal(r.statusText, 'مانده: ۳٬۰۰۰٬۰۰۰ تومان');
  assert.equal(paymentSummary(1000, 3000).remaining, 0);
});

test('field mapping from student/enrollment/course/payments/settings', () => {
  const d = buildDocData({
    student: { first_name: ' سارا ', last_name: 'کریمی', national_code: '0012345678', phone_number: '09120000000', father_name: 'رضا' },
    enrollment: { id: 9, course_number: 3, final_price: 4500000 },
    course: { title: 'پایه سوم', tuition: 1 },
    payments: [{ amount: 1000000 }, { amount: 500000 }],
    settings: { academy_name: 'آموزشگاه نمونه', phone_number: '0831', header_text: 'H', footer_text: 'F' },
    images: { personal: 'data:image/jpeg;base64,AA' },
    date: '1405/07/18',
  });
  assert.equal(d.student.fullName, 'سارا کریمی');
  assert.equal(d.student.mobile, '09120000000');
  assert.equal(d.courseTitle, 'پایه سوم');
  assert.deepEqual([d.money.tuition, d.money.paid, d.money.remaining], [4500000, 1500000, 3000000]);
  assert.equal(d.academy.name, 'آموزشگاه نمونه');
  assert.equal(d.images.nationalCard, null);
  assert.equal(docWarnings(d).length, 1);
  assert.ok(docWarnings(d)[0].includes('کارت ملی'));
  // tuition falls back to the course price when the enrollment has none; academy name has a default
  const e = buildDocData({ student: {}, enrollment: { id: 1 }, course: { title: 'x', tuition: 700 }, settings: {}, date: 'd' });
  assert.equal(e.money.tuition, 700);
  assert.ok(e.academy.name.length > 0);
  assert.equal(e.courseNumber, '');
});

test('contract text: default, numbering stripped, tokens replaced, blank lines dropped', () => {
  assert.equal(contractClauses('').length, DEFAULT_CONTRACT_TEXT.split('\n').length);
  assert.equal(contractClauses(undefined)[0], DEFAULT_CONTRACT_TEXT.split('\n')[0]);
  const c = contractClauses('۱. بند اول {{student_name}}\n\n2- بند دوم\n• سوم {{course_title}} / {{unknown}}', { student_name: 'علی', course_title: 'دوره' });
  assert.deepEqual(c, ['بند اول علی', 'بند دوم', 'سوم دوره /']);
  // a clause that merely starts with a number keeps it
  assert.deepEqual(contractClauses('5 روز مهلت'), ['5 روز مهلت']);
});

test('contract clauses come from settings.contract_text in buildDocData', () => {
  const d = buildDocData({
    student: { first_name: 'a', last_name: 'b', national_code: '1' }, enrollment: { id: 2, final_price: 10 },
    settings: { contract_text: 'شهریه {{tuition}} است\nدوم' }, date: 'd',
  });
  assert.deepEqual(d.contractClauses, ['شهریه ۱۰ است', 'دوم']);
});

console.log(`\n${passed} print-docs tests passed`);
