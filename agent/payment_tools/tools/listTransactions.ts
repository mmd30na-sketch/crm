import type { PaymentTool } from './types';
import { jalaliDateTime, maskCard, pickTerminal, rialToToman, str, toGregorianDate } from './util';

const STATUS_FILTERS = ['ALL', 'VERIFIED', 'PAID', 'TRASH', 'ACTIVE'] as const;
const PAGE = 100;
const MAX_PAGES = 30;

export const zarinpalListTransactions: PaymentTool = {
  name: 'zarinpal_list_transactions',
  description: 'تراکنش‌های درگاه زرین‌پال (همه وضعیت‌ها یا با فیلتر)، با بازه تاریخ (شمسی YYYY/MM/DD یا میلادی YYYY-MM-DD) و جستجو در توضیحات (مثل KRM- یا pkg_). مبالغ به تومان برگردانده می‌شوند. جمع مبالغ موفق و تعداد هر وضعیت را هم می‌دهد. فقط خواندنی.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...STATUS_FILTERS], description: 'ALL همه؛ VERIFIED موفق تأییدشده؛ PAID موفق تأییدنشده؛ TRASH ناموفق؛ ACTIVE همه موفق‌ها' },
      from_date: { type: 'string', description: 'از تاریخ (شمسی یا میلادی)' },
      to_date: { type: 'string', description: 'تا تاریخ (شامل همان روز)' },
      description_contains: { type: 'string', description: 'بخشی از توضیحات تراکنش' },
      terminal_id: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'تعداد ردیف برگشتی (پیش‌فرض ۲۰)' },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  async handler(a, _ctx, deps) {
    const status = STATUS_FILTERS.includes(String(a?.status || 'ALL').toUpperCase() as any) ? String(a?.status || 'ALL').toUpperCase() : 'ALL';
    const from = toGregorianDate(a?.from_date);
    const to = toGregorianDate(a?.to_date);
    const needle = str(a?.description_contains, 100).toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(a?.limit) || 20));
    const offset = Math.max(0, Number(a?.offset) || 0);
    const terminal = await pickTerminal(deps, str(a?.terminal_id, 20) || undefined);
    if (!terminal) return { error: 'هیچ درگاهی برای این حساب پیدا نشد.' };
    const q = status === 'ALL'
      ? 'query S($t: ID, $limit: Int, $offset: Int) { Session(terminal_id: $t, limit: $limit, offset: $offset) { id status amount description created_at session_tries { rrn card_pan } } }'
      : `query S($t: ID, $limit: Int, $offset: Int) { Session(terminal_id: $t, filter: ${status}, limit: $limit, offset: $offset) { id status amount description created_at session_tries { rrn card_pan } } }`;
    const seen = new Map<string, any>();
    for (let p = 0; p < MAX_PAGES; p++) {
      const d = await deps.client.query(q, { t: terminal.id, limit: PAGE, offset: p * PAGE });
      const rows: any[] = Array.isArray(d?.Session) ? d.Session : [];
      let added = 0;
      for (const r of rows) if (r?.id && !seen.has(String(r.id))) { seen.set(String(r.id), r); added++; }
      if (rows.length < PAGE || !added) break;
      // Sessions come newest first: once a full page is older than from_date we can stop.
      if (from && rows.every((r) => String(r.created_at || '').slice(0, 10) < from)) break;
    }
    const inRange = [...seen.values()].filter((r) => {
      const day = String(r.created_at || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (needle && !String(r.description || '').toLowerCase().includes(needle)) return false;
      return true;
    }).sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0));
    const byStatus: Record<string, number> = {};
    let paidToman = 0;
    for (const r of inRange) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.status === 'VERIFIED' || r.status === 'PAID') paidToman += rialToToman(r.amount);
    }
    const rows = inRange.slice(offset, offset + limit).map((r) => {
      const tries: any[] = Array.isArray(r.session_tries) ? r.session_tries : [];
      const t = tries.find((x) => x?.rrn) || tries[tries.length - 1] || {};
      return { session_id: String(r.id), date: jalaliDateTime(r.created_at), status: r.status, amount_toman: rialToToman(r.amount), description: String(r.description || '').slice(0, 200), rrn: t.rrn ? String(t.rrn) : null, card: maskCard(t.card_pan) || null };
    });
    return { terminal_id: terminal.id, filter: { status, from_date: from || null, to_date: to || null, description_contains: needle || null }, total: inRange.length, by_status: byStatus, successful_total_toman: paidToman, offset, limit, rows, note: 'مبالغ API به ریال است و اینجا به تومان تبدیل شده است.' };
  },
};
