import { strict as assert } from 'node:assert';
import {
  normalizeCopilotText, normalizePhoneDigits, maskMobile, maskNationalId,
  maskPiiForModel, studentSearchPlan, studentMatchesPlan,
} from '../copilotPii.ts';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('normalizeCopilotText unifies digits, ي/ك, and spaces', () => {
  assert.equal(normalizeCopilotText('سس ییی'), 'سس ییی');
  assert.equal(normalizeCopilotText('علي ‌رضا'), 'علی رضا');
  assert.equal(normalizeCopilotText('ي ك'), 'ی ک');
  assert.equal(normalizeCopilotText('۰۹۱۲'), '0912');
});

t('normalizePhoneDigits accepts +98, 10-digit, and Persian digits', () => {
  assert.equal(normalizePhoneDigits('09123456789'), '09123456789');
  assert.equal(normalizePhoneDigits('+989123456789'), '09123456789');
  assert.equal(normalizePhoneDigits('9123456789'), '09123456789');
  assert.equal(normalizePhoneDigits('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
});

t('maskMobile uses 0912***6789 (first 4 + last 4)', () => {
  assert.equal(maskMobile('09123456789'), '0912***6789');
  assert.equal(maskMobile('+989123456789'), '0912***6789');
  assert.equal(maskMobile('9123456789'), '0912***6789');
  assert.equal(maskMobile('۰۹۱۲۳۴۵۶۷۸۹'), '0912***6789');
  assert.equal(maskMobile('123'), '123');
  assert.equal(maskMobile('0912***6789'), '0912***6789');
  assert.equal(maskMobile(''), '');
});

t('maskNationalId uses first 3 + last 3', () => {
  assert.equal(maskNationalId('1234567890'), '123***890');
  assert.equal(maskNationalId('۱۲۳۴۵۶۷۸۹۰'), '123***890');
  assert.equal(maskNationalId('123'), '123');
  assert.equal(maskNationalId(''), '');
});

t('maskPiiForModel walks nested objects and free text, leaves ids and tracking codes', () => {
  const masked = maskPiiForModel({
    phone_number: '09123456789',
    national_code: '1234567890',
    students: [
      { student_id: 123, phone_number: '09123456789' },
      { national_code: '1234567890', tracking: 'KRM-12345' },
    ],
    text: 'تماس 09123456789 برای کد ملی 1234567890',
    remaining_debt: 1250000,
  });
  assert.equal(masked.phone_number, '0912***6789');
  assert.equal(masked.national_code, '123***890');
  assert.equal(masked.students[0].phone_number, '0912***6789');
  assert.equal(masked.students[1].national_code, '123***890');
  assert.equal(masked.students[1].tracking, 'KRM-12345');
  assert.match(masked.text, /0912\*\*\*6789/);
  assert.match(masked.text, /123\*\*\*890/);
  assert.equal(masked.students[0].student_id, 123);
  assert.equal(masked.remaining_debt, 1250000);
});

t('studentSearchPlan splits full names and accepts Persian-digit phone / national id', () => {
  const plan = studentSearchPlan('سس ییی');
  assert.equal(plan.nameNorm, 'سس ییی');
  assert.deepEqual(plan.tokens, ['سس', 'ییی']);
  assert.equal(plan.national, '');
  assert.equal(plan.phone, '');
  assert.equal(plan.phone10, '');

  const phonePlan = studentSearchPlan('۰۹۱۲۳۴۵۶۷۸۹');
  assert.equal(phonePlan.phone, '09123456789');
  assert.equal(phonePlan.phone10, '9123456789');

  const nationalPlan = studentSearchPlan('1234567890');
  assert.equal(nationalPlan.national, '1234567890');
});

t('studentMatchesPlan matches full name and word-by-word, including Arabic ي', () => {
  const rows = [
    { first_name: 'سس', last_name: 'ییی' },
    { first_name: 'علی', last_name: 'محمدی' },
    { first_name: 'علي', last_name: 'رضایی' },
  ];
  const plan = studentSearchPlan('سس ییی');
  assert.equal(studentMatchesPlan(rows[0], plan), true);
  assert.equal(studentMatchesPlan(rows[1], plan), false);
  assert.equal(studentMatchesPlan(rows[2], studentSearchPlan('علی')), true);
  assert.equal(studentMatchesPlan(rows[1], studentSearchPlan('محمدی')), true);
  assert.equal(studentMatchesPlan(
    { first_name: 'علی', last_name: 'محمدی', phone_number: '09123456789' },
    studentSearchPlan('09123456789'),
  ), true);
});

console.log(`\n${n} copilot-pii tests passed`);
