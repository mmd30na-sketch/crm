import assert from 'node:assert/strict';
import { matchSmsTemplate, resolveSenderLine, smsirTemplateFields } from '../shared/sms.ts';

const row = smsirTemplateFields({
  id: 926976,
  title: 'زمان کلاس',
  templateText: '#NAME# کلاس #COURSE#',
  status: 2,
  parameters: [{ name: 'NAME' }, { name: ' COURSE ' }, { name: '' }],
});
assert.equal(row.provider_template_id, '926976');
assert.equal(row.title_fa, 'زمان کلاس');
assert.equal(row.body_fa, '#NAME# کلاس #COURSE#');
assert.equal(row.param_names, 'NAME,COURSE');
assert.equal(row.provider_status, 2);

const rows = [
  { key: 'class_schedule', provider_template_id: '926976', channel_kind: 'verify' },
  { key: 'debt_balance', provider_template_id: '472328', enabled: 0 },
];
assert.equal(matchSmsTemplate(rows, 'class_time')?.key, 'class_schedule');
assert.equal(matchSmsTemplate(rows, 'missing', 472328)?.key, 'debt_balance');
assert.equal(matchSmsTemplate(rows, 'debt_balance')?.enabled, 0);
assert.equal(matchSmsTemplate(rows, 'nope', ''), null);

delete process.env.SMS_SENDER_LINE;
assert.equal(resolveSenderLine(''), '');
assert.equal(resolveSenderLine('30001111'), '30001111');
process.env.SMS_SENDER_LINE = '30002222';
assert.equal(resolveSenderLine(''), '30002222');
assert.equal(resolveSenderLine('30001111', '30003333'), '30003333');
delete process.env.SMS_SENDER_LINE;

console.log('sms template sync: ok');
