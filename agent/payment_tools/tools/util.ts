import { maskCard } from '../../../zarinpalSettings';

export const rialToToman = (rial: unknown) => Math.round((Number(rial) || 0) / 10);
export const str = (v: unknown, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
export const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
export { maskCard };

/** Jalali (YYYY/MM/DD, Persian or Latin digits) or Gregorian (YYYY-MM-DD) -> Gregorian YYYY-MM-DD, or ''. */
export function toGregorianDate(input: unknown): string {
  const s = String(input ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim();
  const m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return '';
  let [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1700) [y, mo, d] = jalaliToGregorian(y, mo, d);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Standard jalali -> gregorian conversion (jalaali algorithm). */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return [gy, gm, gd];
}

/** ISO timestamp -> Jalali date-time in Tehran (for the model to quote). */
export const jalaliDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Picks the terminal of the configured merchant (or the first). Never returns the terminal key. */
export async function pickTerminal(deps: { client: any }, wanted?: string): Promise<{ id: string; domain: string } | null> {
  const d = await deps.client.query('query { Terminals { id domain key } }');
  const list: any[] = Array.isArray(d?.Terminals) ? d.Terminals : [];
  const mid = String(deps.client.config().merchantId || '').toLowerCase();
  const t = list.find((x) => String(x.id) === wanted) || list.find((x) => mid && String(x.key || '').toLowerCase() === mid) || list[0];
  return t ? { id: String(t.id), domain: String(t.domain || '') } : null;
}
