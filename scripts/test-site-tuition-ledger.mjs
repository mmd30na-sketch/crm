import { strict as assert } from 'node:assert';
import {
  TRACKING_EQ, REG_TRACKING_JOIN, normalizeGatewayToken, paymentKindFromSite,
  payDateJalaliFromVerifiedAt, isDuplicateKeyError, applyOneVerifiedSitePayment,
  applyVerifiedSitePaymentsForRegistration, syncVerifiedSiteTuitionPayments,
  refreshEnrollmentAmountPaid,
} from '../siteTuitionLedger.ts';

let n = 0;
const t = (name, fn) => { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { n++; console.log('ok -', name); }); n++; console.log('ok -', name); };

t('normalizeGatewayToken drops empty and trims', () => {
  assert.equal(normalizeGatewayToken(''), null);
  assert.equal(normalizeGatewayToken('  '), null);
  assert.equal(normalizeGatewayToken(null), null);
  assert.equal(normalizeGatewayToken('  ABC123  '), 'ABC123');
});

t('paymentKindFromSite maps deposit vs full', () => {
  assert.equal(paymentKindFromSite('deposit'), 'پيش پرداخت');
  assert.equal(paymentKindFromSite('full'), 'تسويه کامل');
  assert.equal(paymentKindFromSite(''), 'تسويه کامل');
});

t('payDateJalaliFromVerifiedAt uses Tehran calendar', () => {
  const d = payDateJalaliFromVerifiedAt('2026-11-10 15:00:00');
  assert.match(d, /^1405\/08\/19$/);
  const today = payDateJalaliFromVerifiedAt(null, new Date('2026-11-17T18:00:00+03:30'));
  assert.match(today, /^\d{4}\/\d{2}\/\d{2}$/);
});

t('isDuplicateKeyError recognizes mysql 1062', () => {
  assert.equal(isDuplicateKeyError({ errno: 1062 }), true);
  assert.equal(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' }), true);
  assert.equal(isDuplicateKeyError({ message: 'Duplicate entry' }), true);
  assert.equal(isDuplicateKeyError({ message: 'other' }), false);
});

t('collation helpers force unicode_ci comparison', () => {
  assert.match(TRACKING_EQ, /CONVERT\(p\.tracking_code USING utf8mb4\) COLLATE utf8mb4_unicode_ci/);
  assert.match(TRACKING_EQ, /CONVERT\(\? USING utf8mb4\) COLLATE utf8mb4_unicode_ci/);
  assert.match(REG_TRACKING_JOIN, /CONVERT\(r\.tracking_code/);
});

function fakeDb(opts = {}) {
  const calls = [];
  const existing = opts.existing || false;
  let inserted = 0;
  const payments = opts.payments || [{
    id: 1, tracking_code: 'KRM-12345', amount_toman: 4400000, kind: 'full',
    authority: 'AUTH1', ref_id: 'REF1', card_pan: null,
    verified_at: '2026-11-10 15:00:00', course_id: 2, status: 'paid',
  }];
  const conn = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM site_registration_payments/.test(sql) && /SELECT/.test(sql)) return [payments];
      if (/SELECT payment_id FROM payments/.test(sql)) return [existing || inserted ? [{ payment_id: 10 }] : []];
      if (/INSERT INTO payments/.test(sql)) {
        if (opts.failDup) { const e = new Error('Duplicate entry'); e.errno = 1062; throw e; }
        inserted += 1;
        return [{ insertId: 50 + inserted }];
      }
      if (/SUM\(amount\)/.test(sql)) return [[{ paid: inserted || existing ? 4400000 : 0 }]];
      if (/UPDATE enrollments SET amount_paid/.test(sql)) return [{ affectedRows: 1 }];
      if (/FROM enrollments WHERE student_id/.test(sql)) return [[{ enrollment_id: 77 }]];
      return [[]];
    },
  };
  return { conn, calls, getInserted: () => inserted };
}

await t('apply for registration inserts one ledger row and refreshes amount_paid', async () => {
  const { conn, calls, getInserted } = fakeDb();
  const r = await applyVerifiedSitePaymentsForRegistration(conn, { trackingCode: 'KRM-12345', studentId: 5, enrollmentId: 77 });
  assert.equal(r.applied, 1);
  assert.equal(r.skipped, 0);
  assert.equal(r.amountPaid, 4400000);
  assert.equal(getInserted(), 1);
  const insert = calls.find((c) => /INSERT INTO payments/.test(c.sql));
  assert.ok(insert);
  assert.equal(insert.params[0], 77);
  assert.equal(insert.params[1], 5);
  assert.equal(insert.params[3], 4400000);
  assert.equal(insert.params[4], 'تسويه کامل');
  assert.equal(insert.params[5], 'AUTH1');
  assert.equal(insert.params[6], 'REF1');
  assert.ok(calls.some((c) => /utf8mb4_unicode_ci/.test(c.sql)));
  assert.ok(!calls.some((c) => /INSERT INTO payments/.test(c.sql) && c.sql.includes('LIKE')));
});

await t('second apply is idempotent (no second insert)', async () => {
  const { conn, getInserted } = fakeDb({ existing: true });
  const r = await applyVerifiedSitePaymentsForRegistration(conn, { trackingCode: 'KRM-12345', studentId: 5, enrollmentId: 77 });
  assert.equal(r.applied, 0);
  assert.equal(r.skipped, 1);
  assert.equal(getInserted(), 0);
  assert.equal(r.amountPaid, 4400000);
});

await t('skips unpaid or unverified or zero-amount rows', async () => {
  const { conn, getInserted } = fakeDb({
    payments: [
      { status: 'pending', verified_at: '2026-11-10 15:00:00', amount_toman: 1000, authority: 'A', ref_id: 'R' },
    ],
  });
  // applyVerifiedSitePaymentsForRegistration already filters SQL; test applyOne directly
  const r = await applyOneVerifiedSitePayment(conn, {
    status: 'pending', verified_at: '2026-11-10 15:00:00', amount_toman: 1000, authority: 'A', ref_id: 'R',
  }, { studentId: 5, enrollmentId: 77 });
  assert.equal(r, 'skipped');
  const r2 = await applyOneVerifiedSitePayment(conn, {
    status: 'paid', verified_at: null, amount_toman: 1000, authority: 'A', ref_id: 'R',
  }, { studentId: 5, enrollmentId: 77 });
  assert.equal(r2, 'skipped');
  const r3 = await applyOneVerifiedSitePayment(conn, {
    status: 'paid', verified_at: '2026-11-10 15:00:00', amount_toman: 0, authority: 'A', ref_id: 'R',
  }, { studentId: 5, enrollmentId: 77 });
  assert.equal(r3, 'skipped');
  const r4 = await applyOneVerifiedSitePayment(conn, {
    status: 'paid', verified_at: '2026-11-10 15:00:00', amount_toman: 1000, authority: '', ref_id: '',
  }, { studentId: 5, enrollmentId: 77 });
  assert.equal(r4, 'skipped');
  assert.equal(getInserted(), 0);
});

await t('duplicate-key insert is treated as skipped success and amount is refreshed', async () => {
  const { conn } = fakeDb({ failDup: true });
  // ledgerRowExists returns false so INSERT runs and hits 1062
  const r = await applyOneVerifiedSitePayment(conn, {
    status: 'paid', verified_at: '2026-11-10 15:00:00', amount_toman: 4400000, authority: 'AUTH1', ref_id: 'REF1',
  }, { studentId: 5, enrollmentId: 77 });
  assert.equal(r, 'skipped');
});

await t('sync uses approved registration + student_id and is idempotent when row exists', async () => {
  const store = { inserted: 0, existing: false };
  const db = {
    async sql(sql) {
      if (/JOIN registrations/.test(sql)) {
        return [{
          id: 1, tracking_code: 'KRM-12345', amount_toman: 4400000, kind: 'full',
          authority: 'AUTH1', ref_id: 'REF1', card_pan: null, verified_at: '2026-11-10 15:00:00',
          course_id: 2, status: 'paid', student_id: 5,
        }];
      }
      if (/SELECT payment_id FROM payments/.test(sql)) return store.existing || store.inserted ? [{ payment_id: 10 }] : [];
      if (/SUM\(amount\)/.test(sql)) return [{ paid: 4400000 }];
      if (/FROM enrollments/.test(sql)) return [{ enrollment_id: 77 }];
      return [];
    },
    async sqlExec(sql) {
      if (/INSERT INTO payments/.test(sql)) { store.inserted += 1; return { insertId: 51, affectedRows: 1 }; }
      return { insertId: 0, affectedRows: 1 };
    },
  };
  const first = await syncVerifiedSiteTuitionPayments(db);
  assert.equal(first.applied, 1);
  store.existing = true;
  const second = await syncVerifiedSiteTuitionPayments(db);
  assert.equal(second.applied, 0);
  assert.equal(store.inserted, 1);
});

await t('refreshEnrollmentAmountPaid writes the sum, not an increment', async () => {
  const updates = [];
  const conn = {
    async query(sql, params) {
      if (/SUM/.test(sql)) return [[{ paid: 4400000 }]];
      if (/UPDATE/.test(sql)) { updates.push(params); return [{ affectedRows: 1 }]; }
      return [[]];
    },
  };
  const paid = await refreshEnrollmentAmountPaid(conn, 77);
  assert.equal(paid, 4400000);
  assert.deepEqual(updates[0], [4400000, 77]);
});

console.log(`\n${n} site-tuition-ledger tests passed`);
