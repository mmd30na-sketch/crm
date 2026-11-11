import type { PaymentTool } from './types';
import { explainError, ZARINPAL_ERRORS } from '../client/errors';

export const zarinpalErrorExplain: PaymentTool = {
  name: 'zarinpal_error_explain',
  description: 'معنی کد خطا یا کد وضعیت زرین‌پال (مثل -9، -54، -62، 100، 101) از فهرست رسمی مستندات. بدون ارتباط با شبکه.',
  parameters: { type: 'object', properties: { code: { type: 'string', description: 'کد عددی، مثل -54' } }, required: ['code'], additionalProperties: false },
  async handler(a) {
    const info = explainError(a?.code);
    return info ? { found: true, ...info } : { found: false, known_codes: Object.keys(ZARINPAL_ERRORS) };
  },
};
