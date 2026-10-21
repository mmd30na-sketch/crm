/**
 * Today's date for the Copilot system prompt, computed per request in Asia/Tehran.
 * Pure (no Node/DOM imports); tested by scripts/test-copilot-date.mjs.
 */
import { jalaliTodayParts } from './normalize';

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const faDigits = (v: string | number) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const pad = (n: number) => String(n).padStart(2, '0');

export interface CopilotDate {
  jalali: string; jalaliText: string; weekday: string; gregorian: string;
  month: string; monthText: string; prevMonth: string; prevMonthText: string;
}

export function copilotDate(now: Date = new Date()): CopilotDate {
  const { jy, jm, jd } = jalaliTodayParts(now);
  const weekday = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long' }).format(now);
  const g = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const py = jm === 1 ? jy - 1 : jy;
  const pm = jm === 1 ? 12 : jm - 1;
  return {
    jalali: `${jy}/${pad(jm)}/${pad(jd)}`,
    jalaliText: `${faDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${faDigits(jy)}`,
    weekday,
    gregorian: g.replace(/-/g, '/'),
    month: `${jy}/${pad(jm)}`,
    monthText: `${JALALI_MONTHS[jm - 1]} ${faDigits(jy)}`,
    prevMonth: `${py}/${pad(pm)}`,
    prevMonthText: `${JALALI_MONTHS[pm - 1]} ${faDigits(py)}`,
  };
}

/** One prompt line plus the rule for relative dates. */
export function copilotDateRule(now: Date = new Date()): string {
  const d = copilotDate(now);
  return `۱۱) امروز (وقت تهران): ${d.weekday} ${d.jalaliText} (${d.jalali})، میلادی ${d.gregorian}. ماه جاری ${d.monthText} (${d.month})؛ ماه قبل ${d.prevMonthText} (${d.prevMonth}). `
    + '«امروز»، «این ماه» و «ماه قبل» را با همین تاریخ تفسیر کنید و برای پرسیدن تاریخ امروز ابزاری صدا نزنید. '
    + 'برای درآمد یک ماه، مستقیم monthly_income را با ماه شمسی YYYY/MM صدا بزنید (اگر نبود get_financial_report) و جدول‌ها را کاوش نکنید.';
}
