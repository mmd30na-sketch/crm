import type { PaymentTool } from './types';
import { num, str } from './util';

const LINK_DAYS = 7;
const sqlDateTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

export const zarinpalCreatePaymentLink: PaymentTool = {
  name: 'zarinpal_create_payment_link',
  description: 'برای یک هنرجو لینک پرداخت آنلاین (زرین‌پال) می‌سازد؛ همان لینک «/p/کد» که در پیامک بدهی استفاده می‌شود. فقط لینک ساخته می‌شود و چیزی ارسال نمی‌شود؛ برای ارسال از ابزارهای پیامک طبق قوانین پیامک استفاده کنید. مبلغ به تومان و حداکثر به اندازه بدهی فعلی هنرجو پرداخت می‌شود.',
  parameters: {
    type: 'object',
    properties: {
      student_id: { type: 'integer', description: 'شناسه هنرجو (الزامی؛ لینک بدون هنرجو در CRM ثبت نمی‌شود)' },
      amount_toman: { type: 'number', description: 'مبلغ به تومان؛ اگر خالی باشد کل بدهی' },
      description: { type: 'string', description: 'توضیح برای گزارش به مدیر (در لینک ذخیره نمی‌شود)' },
    },
    required: ['student_id'],
    additionalProperties: false,
  },
  async handler(a, ctx, deps) {
    if (ctx.role !== 'admin') return { error: 'این ابزار فقط برای مدیر فعال است.' };
    const studentId = Math.trunc(num(a?.student_id));
    if (!(studentId > 0)) return { error: 'student_id الزامی است.' };
    const student = await deps.links.studentInfo(studentId);
    if (!student) return { error: 'هنرجو پیدا نشد.' };
    const debt = await deps.links.studentDebt(studentId);
    const requested = a?.amount_toman === undefined || a?.amount_toman === null ? debt : num(a.amount_toman);
    if (!(requested > 0)) return { error: debt > 0 ? 'مبلغ نامعتبر است.' : 'این هنرجو بدهی ندارد.' };
    if (requested > 100_000_000) return { error: 'حداکثر مبلغ زرین‌پال ۱۰۰ میلیون تومان است (کد -41).' };
    const now = deps.now ? deps.now() : new Date();
    const link = await deps.links.createLink(studentId, Math.round(requested), sqlDateTime(new Date(now.getTime() + LINK_DAYS * 86400_000)));
    const base = deps.paymentLinkBase();
    return {
      ok: true, student: `${student.first_name} ${student.last_name}`.trim(), student_id: studentId,
      amount_toman: Math.round(requested), current_debt_toman: debt, url: `${base}${link.code}`, code: link.code,
      expires_in_days: LINK_DAYS, description: str(a?.description, 200) || null, sandbox: deps.client.config().sandbox,
      note: 'لینک ساخته شد ولی ارسال نشده است. مبلغ قابل پرداخت هنگام باز کردن لینک حداکثر به اندازه بدهی همان لحظه است.',
    };
  },
};
