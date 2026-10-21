/**
 * Read-only Umami analytics for the Copilot (GET requests only, plus login).
 * Env: UMAMI_URL, UMAMI_USERNAME, UMAMI_PASSWORD, UMAMI_WEBSITE_ID.
 * Day boundaries use Tehran time (fixed UTC+03:30; Iran has no DST since 2022).
 */
const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000;
const DAY = 86400000;
const TIMEOUT_MS = 10000;
const METRIC_TYPES = ['path', 'referrer', 'device', 'city', 'event', 'browser', 'os', 'country'] as const;
const DEFAULT_METRICS = ['path', 'referrer', 'device'];
let token: string | null = null;

export function umamiEnabled() {
  return Boolean(process.env.UMAMI_URL && process.env.UMAMI_USERNAME && process.env.UMAMI_PASSWORD && process.env.UMAMI_WEBSITE_ID);
}
const base = () => String(process.env.UMAMI_URL || '').replace(/\/+$/, '');

async function login(): Promise<string> {
  const r = await fetch(`${base()}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ username: process.env.UMAMI_USERNAME, password: process.env.UMAMI_PASSWORD }),
  });
  if (!r.ok) throw new Error(`umami login failed: HTTP ${r.status}`);
  const j: any = await r.json();
  if (!j?.token) throw new Error('umami login returned no token');
  return (token = j.token);
}

async function get(path: string, q: Record<string, string | number>): Promise<any> {
  const url = `${base()}${path}?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = token || (await login());
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 401 && attempt === 0) { token = null; continue; }
    if (!r.ok) throw new Error(`umami ${path}: HTTP ${r.status}`);
    return r.json();
  }
}

/** Jalali -> Gregorian (standard jalaali algorithm). */
function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const ml = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1; while (gm <= 12 && gd > ml[gm]) { gd -= ml[gm]; gm++; }
  return [gy, gm, gd];
}

/** Tehran-midnight (UTC ms) for a YYYY-MM-DD date; years < 1700 are treated as Jalali. */
function tehranDayStart(s: string): number {
  const m = String(s || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) throw new Error(`bad date: ${s} (use YYYY-MM-DD)`);
  let [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1700) [y, mo, d] = jalaliToGregorian(y, mo, d);
  return Date.UTC(y, mo - 1, d) - TEHRAN_OFFSET_MS;
}

export function resolveRange(period: string, startDate?: string, endDate?: string, now = Date.now()) {
  const todayStart = Math.floor((now + TEHRAN_OFFSET_MS) / DAY) * DAY - TEHRAN_OFFSET_MS;
  switch (period || 'today') {
    case 'today': return { startAt: todayStart, endAt: now };
    case 'yesterday': return { startAt: todayStart - DAY, endAt: todayStart - 1 };
    case '7d': return { startAt: todayStart - 6 * DAY, endAt: now };
    case '30d': return { startAt: todayStart - 29 * DAY, endAt: now };
    case 'custom': {
      const s = tehranDayStart(String(startDate));
      const e = Math.min(tehranDayStart(String(endDate || startDate)) + DAY - 1, now);
      if (e < s) throw new Error('endDate is before startDate');
      if (e - s > 366 * DAY) throw new Error('range too long (max 366 days)');
      return { startAt: s, endAt: e };
    }
    default: throw new Error(`unknown period: ${period}`);
  }
}

const val = (x: any) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const fmt = (ms: number) => new Date(ms + TEHRAN_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');

export async function getSiteAnalytics(a: { period?: string; startDate?: string; endDate?: string; metrics?: string[] }) {
  if (!umamiEnabled()) return { error: 'آمار سایت (Umami) پیکربندی نشده است.' };
  try {
    const { startAt, endAt } = resolveRange(String(a.period || 'today'), a.startDate, a.endDate);
    const id = encodeURIComponent(String(process.env.UMAMI_WEBSITE_ID));
    const wanted = (Array.isArray(a.metrics) && a.metrics.length ? a.metrics : DEFAULT_METRICS)
      .map(String).filter((m) => (METRIC_TYPES as readonly string[]).includes(m)).slice(0, 8);
    const [stats, active, ...lists] = await Promise.all([
      get(`/api/websites/${id}/stats`, { startAt, endAt }),
      get(`/api/websites/${id}/active`, {}).catch(() => null),
      ...wanted.map((type) => get(`/api/websites/${id}/metrics`, { startAt, endAt, type, limit: 10 })),
    ]);
    const s: any = stats || {};
    const metrics: Record<string, any> = {};
    wanted.forEach((m, i) => { metrics[m] = (Array.isArray(lists[i]) ? lists[i] : []).slice(0, 10).map((r: any) => ({ x: r.x, y: r.y })); });
    return {
      timezone: 'Asia/Tehran', from: fmt(startAt), to: fmt(endAt),
      pageviews: val(s.pageviews), visitors: val(s.visitors), visits: val(s.visits),
      bounces: val(s.bounces), totaltime_sec: val(s.totaltime),
      active_now: active ? (active.visitors ?? active.x ?? val(active)) : null,
      top: metrics,
    };
  } catch (e: any) {
    return { error: `خطا در دریافت آمار سایت: ${String(e?.message || e).slice(0, 200)}` };
  }
}
