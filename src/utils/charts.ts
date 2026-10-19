/**
 * Pure chart helpers (no DOM), unit-tested in scripts/test-crm-logic.mjs.
 */
import { normalizeJalaliDate } from './normalize';

export const JALALI_MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export type MonthPoint = { key: string; month: string; income: number; expense: number };

/**
 * Income/expense per Jalali month, in calendar order (year + month, so مهر 1404 and مهر 1405 are not merged),
 * with empty months between the first and last month kept so the axis has no gaps. The label carries the
 * year (Persian digits) when the data spans more than one year. At most the last `maxMonths` months.
 */
export function monthlySeries(
  income: Array<{ date?: string; amount: number }>,
  expense: Array<{ date?: string; amount: number }>,
  maxMonths = 24,
): MonthPoint[] {
  const sums = new Map<string, { income: number; expense: number }>();
  const add = (raw: string | undefined, amount: number, kind: 'income' | 'expense') => {
    const d = normalizeJalaliDate(raw);
    if (!d) return;
    const key = d.slice(0, 7); // yyyy/mm
    const cur = sums.get(key) || { income: 0, expense: 0 };
    cur[kind] += Number(amount) || 0;
    sums.set(key, cur);
  };
  income.forEach((r) => add(r.date, r.amount, 'income'));
  expense.forEach((r) => add(r.date, r.amount, 'expense'));
  if (!sums.size) return [];

  const keys = [...sums.keys()].sort();
  const toIndex = (k: string) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1;
  const first = Math.max(toIndex(keys[0]), toIndex(keys[keys.length - 1]) - (maxMonths - 1));
  const last = toIndex(keys[keys.length - 1]);
  const years = new Set<number>();
  for (let i = first; i <= last; i++) years.add(Math.floor(i / 12));
  const out: MonthPoint[] = [];
  for (let i = first; i <= last; i++) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    const key = `${y}/${String(m).padStart(2, '0')}`;
    const v = sums.get(key) || { income: 0, expense: 0 };
    const name = JALALI_MONTH_NAMES[m - 1];
    out.push({
      key,
      month: years.size > 1 ? `${name} ${y.toLocaleString('fa-IR', { useGrouping: false })}` : name,
      income: v.income,
      expense: v.expense,
    });
  }
  return out;
}
