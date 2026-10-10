#!/usr/bin/env node
/**
 * Unit tests for the shared pure helpers (balances, Jalali dates, digits/national codes, list filters).
 * Synthetic data only, no network or database.
 * Run: npm run test:logic   (= node --import tsx scripts/test-crm-logic.mjs)
 */
import assert from 'node:assert/strict';
import {
  owedByEnrollment, studentBalance, totalOutstanding, allocatePayment, payableAmount,
} from '../src/utils/finance.ts';
import {
  normalizeJalaliDate, jalaliToday, jalaliTodayParts, normalizeNationalCode, nationalCodeVariants, checkNationalCode, searchKey, sameName,
  cleanText, photoPath,
} from '../src/utils/normalize.ts';
import { monthlySeries } from '../src/utils/charts.ts';
import {
  matchesStudentSearch, matchesCourseNumber, defaultCourseNumberFilter, financialStatus,
} from '../src/utils/studentFilters.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

/* ── balances ── */
test('settled enrollment (final_price lowered below paid) does not cancel another debt', () => {
  const enr = [{ id: 1, final_price: 1000 }, { id: 2, final_price: 5000 }];
  const pay = [{ enrollment_id: 1, amount: 3000 }, { enrollment_id: 2, amount: 1000 }];
  const b = studentBalance(enr, pay);
  assert.equal(b.owed.get(1), 0);
  assert.equal(b.owed.get(2), 4000);
  assert.equal(b.debt, 4000); // netted (6000 - 4000 = 2000) would be wrong
});

test('final_price 0 with no payments owes nothing', () => {
  assert.equal(studentBalance([{ id: 7, final_price: 0 }], []).debt, 0);
});

test('payments without an existing enrollment are ignored (not counted as paid)', () => {
  const enr = [{ id: 5, final_price: 2000 }, { id: 3, final_price: 1000 }];
  const pay = [{ enrollment_id: null, amount: 1500 }, { enrollment_id: 99, amount: 700 }, { enrollment_id: 3, amount: 400 }];
  const owed = owedByEnrollment(enr, pay);
  assert.equal(owed.get(3), 600);
  assert.equal(owed.get(5), 2000);
  const b = studentBalance(enr, pay);
  assert.equal(b.totalPaid, 400);
  assert.equal(b.debt, 2600);
});

test('totalOutstanding sums clamped balances per student', () => {
  const enr = [
    { id: 1, student_id: 1, final_price: 1000 }, { id: 2, student_id: 1, final_price: 3000 },
    { id: 3, student_id: 2, final_price: 500 },
  ];
  const pay = [{ student_id: 1, enrollment_id: 1, amount: 2500 }, { student_id: 2, enrollment_id: 3, amount: 100 }];
  assert.equal(totalOutstanding(enr, pay), 3000 + 400);
});

test('payableAmount and allocatePayment (linked and spread)', () => {
  const owed = new Map([[1, 0], [2, 700], [3, 300]]);
  assert.equal(payableAmount(owed, null), 1000);
  assert.equal(payableAmount(owed, 3), 300);
  assert.equal(payableAmount(owed, 1), 0);
  assert.deepEqual(allocatePayment([1, 2, 3], owed, 800, null), [{ enrollmentId: 2, amount: 700 }, { enrollmentId: 3, amount: 100 }]);
  assert.deepEqual(allocatePayment([1, 2, 3], owed, 50, 3), [{ enrollmentId: 3, amount: 50 }]);
  assert.deepEqual(allocatePayment([], new Map(), 50, null), [{ enrollmentId: null, amount: 50 }]);
});

/* ── Jalali dates ── */
test('normalizeJalaliDate accepts real dates in any digit script / separator', () => {
  assert.equal(normalizeJalaliDate('۱۴۰۵/۷/۱۶'), '1405/07/16');
  assert.equal(normalizeJalaliDate('1405-07-16'), '1405/07/16');
  assert.equal(normalizeJalaliDate(' 1404.12.30 '), '1404/12/30');
  assert.equal(normalizeJalaliDate('1405/06/31'), '1405/06/31');
});

test('normalizeJalaliDate rejects non-dates', () => {
  for (const bad of ['', 'abc', '1405/13/01', '1405/00/10', '1405/07/31', '1405/12/31', '1405/1/0', '05/07/16', '1405/07/16 x', '2026-10-10', '1405/07']) {
    assert.equal(normalizeJalaliDate(bad), '', bad);
  }
});

test('jalaliToday uses the Tehran day, not the server time zone', () => {
  // 2026-10-09 21:00 UTC is already 2026-10-10 00:30 in Tehran (UTC+3:30) = 1405/07/18.
  assert.equal(jalaliToday(new Date(Date.UTC(2026, 9, 9, 21, 0))), '1405/07/18');
  assert.equal(jalaliToday(new Date(Date.UTC(2026, 9, 9, 20, 0))), '1405/07/17');
  assert.match(jalaliToday(), /^14\d{2}\/\d{2}\/\d{2}$/);
});

/* ── digits / national codes ── */
test('national code normalization and stored-spelling variants', () => {
  assert.equal(normalizeNationalCode(' ۰۰۱۲-۳۴۵ ٦٧٨ '), '0012345678');
  assert.deepEqual(nationalCodeVariants('0012345678'), ['0012345678', '۰۰۱۲۳۴۵۶۷۸', '٠٠١٢٣٤٥٦٧٨']);
  assert.deepEqual(nationalCodeVariants(''), []);
});

test('checkNationalCode: length is an error, checksum only a warning', () => {
  assert.ok(checkNationalCode('12345').error);
  assert.ok(checkNationalCode('12345678ab').error);
  const bad = checkNationalCode('0012345678');
  assert.ok(!bad.error && bad.warning);
  const good = checkNationalCode('۰۰۱۲۳۴۵۶۷۹'); // checksum-valid code typed with Persian digits
  assert.equal(good.code, '0012345679');
  assert.ok(!good.error && !good.warning);
});

test('searchKey and sameName', () => {
  assert.equal(searchKey('علي ۰۹۱۲'), 'علی 0912');
  assert.ok(sameName('محمد علی', 'كريمي', 'محمدعلی', 'کریمی'));
  assert.ok(!sameName('علی', 'رضایی', 'علی', 'احمدی'));
  assert.ok(!sameName('', '', '', ''));
});

/* ── students list filters ── */
test('search matches Persian digits against Latin phone / national code, null-safe', () => {
  const s = { first_name: 'سارا', last_name: 'احمدی', national_code: '0459876543', phone_number: '09198765432' };
  assert.ok(matchesStudentSearch(s, '۰۹۱۹'));
  assert.ok(matchesStudentSearch(s, '٠٤٥٩'));
  assert.ok(matchesStudentSearch(s, 'سارا'));
  assert.ok(!matchesStudentSearch(s, '0912'));
  assert.ok(matchesStudentSearch({ first_name: 'علی', last_name: null, national_code: null, phone_number: null }, 'علی'));
  assert.ok(!matchesStudentSearch({ first_name: 'علی', national_code: null, phone_number: null }, '123'));
});

test('course-number filter default and students without enrollments', () => {
  assert.equal(defaultCourseNumberFilter([3, 12, null, 7]), '12');
  assert.equal(defaultCourseNumberFilter([]), 'all');
  assert.ok(matchesCourseNumber([], '12'));
  assert.ok(matchesCourseNumber([12, 3], '12'));
  assert.ok(!matchesCourseNumber([3], '12'));
  assert.ok(matchesCourseNumber([3], 'all'));
});

test('financial status: tuition 0 with no debt is settled, not a debtor', () => {
  assert.equal(financialStatus({ debt: 0, enrollmentsCount: 1 }), 'settled');
  assert.equal(financialStatus({ debt: 10, enrollmentsCount: 1 }), 'debtor');
  assert.equal(financialStatus({ debt: 0, enrollmentsCount: 0 }), 'none');
});

/* ── text / photo paths ── */
test('cleanText: one trimmed line, ZWNJ kept', () => {
  assert.equal(cleanText('  علی\n\r\tرضا \u0000 '), 'علی رضا');
  assert.equal(cleanText('محمد\u200cرضا'), 'محمد\u200cرضا');
  assert.equal(cleanText('a\u2028b'), 'a b');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText('abcdef', 3), 'abc');
});

test('photoPath: bare file names are no photo, ;-lists give the first usable path', () => {
  assert.equal(photoPath('Screenshot (1).png'), undefined);
  assert.equal(photoPath(''), undefined);
  assert.equal(photoPath(null), undefined);
  assert.equal(photoPath('/StudentFiles/12/a_1_ID.jpg'), '/StudentFiles/12/a_1_ID.jpg');
  assert.equal(photoPath('a.png; /StudentFiles/x.jpg;/StudentFiles/y.jpg'), '/StudentFiles/x.jpg');
  assert.equal(photoPath('https://cdn.example/p.jpg'), 'https://cdn.example/p.jpg');
});

test('jalaliTodayParts follows the Tehran day', () => {
  assert.deepEqual(jalaliTodayParts(new Date(Date.UTC(2026, 9, 9, 21, 0))), { jy: 1405, jm: 7, jd: 18 });
});

/* ── charts ── */
test('monthlySeries: calendar order across years, gaps filled, years not merged', () => {
  const s = monthlySeries(
    [{ date: '1404/07/05', amount: 100 }, { date: '۱۴۰۵/۰۷/۰۱', amount: 50 }, { date: '1404/09/30', amount: 10 }, { date: 'bad', amount: 999 }],
    [{ date: '1404/08/02', amount: 7 }],
    24,
  );
  assert.equal(s.length, 13); // 1404/07 .. 1405/07
  assert.equal(s[0].key, '1404/07');
  assert.equal(s[0].income, 100);
  assert.equal(s[1].expense, 7);
  assert.equal(s[2].income, 10);
  assert.equal(s[12].key, '1405/07');
  assert.equal(s[12].income, 50);
  assert.match(s[0].month, /^مهر /); // year shown when the data spans two years
  const one = monthlySeries([{ date: '1405/07/01', amount: 1 }, { date: '1405/09/01', amount: 1 }], []);
  assert.deepEqual(one.map((p) => p.month), ['مهر', 'آبان', 'آذر']);
  assert.equal(monthlySeries([], []).length, 0);
  assert.equal(monthlySeries([{ date: '1400/01/01', amount: 1 }, { date: '1405/01/01', amount: 1 }], [], 6).length, 6);
});

console.log(`\n${passed} tests passed`);
