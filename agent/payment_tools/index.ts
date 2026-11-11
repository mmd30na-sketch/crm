/**
 * Ham-Raz payment tools: registry. server.ts adds `toolDefinitions()` to the admin tool list when the
 * «ابزارهای پرداخت» toggle (Settings → تنظیمات هم‌راز) is on, appends `skillsPrompt()` to the system prompt,
 * and routes calls whose name starts with `zarinpal_` to `run()`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PaymentTool, PaymentToolDeps, ToolCtx } from './tools/types';
import { zarinpalListTerminals } from './tools/listTerminals';
import { zarinpalListTransactions } from './tools/listTransactions';
import { zarinpalTransactionInquiry } from './tools/inquiry';
import { zarinpalUnverifiedList } from './tools/unverified';
import { zarinpalCreatePaymentLink } from './tools/createPaymentLink';
import { zarinpalVerifyPayment } from './tools/verifyPayment';
import { zarinpalErrorExplain } from './tools/errorExplain';
import { zarinpalReconcileList } from './tools/reconcileList';
import { zarinpalReverse } from './tools/reverse';
import { zarinpalRefund } from './tools/refund';

export { executePaymentAction } from './executor';
export { createZarinpalClient } from './client';
export type { PaymentAction, PaymentToolDeps, ToolCtx } from './tools/types';

export const PAYMENT_TOOLS: readonly PaymentTool[] = [
  zarinpalListTerminals, zarinpalListTransactions, zarinpalTransactionInquiry, zarinpalUnverifiedList,
  zarinpalCreatePaymentLink, zarinpalVerifyPayment, zarinpalErrorExplain, zarinpalReconcileList,
  zarinpalReverse, zarinpalRefund,
];
const BY_NAME = new Map(PAYMENT_TOOLS.map((t) => [t.name, t]));
export const isPaymentTool = (name: string) => BY_NAME.has(name);

/** OpenAI function-calling definitions. */
export const toolDefinitions = () => PAYMENT_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

/** Runs one tool. Errors become `{ error }` (Persian), never a thrown stack with request details. */
export async function runPaymentTool(name: string, args: any, ctx: ToolCtx, deps: PaymentToolDeps): Promise<any> {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `ابزار ناشناخته: ${name}` };
  if (ctx.role !== 'admin') return { error: 'ابزارهای پرداخت فقط برای مدیر فعال است.' };
  try {
    return await tool.handler(args || {}, ctx, deps);
  } catch (e: any) {
    return { error: String(e?.message || 'اجرای ابزار پرداخت ناموفق بود.').slice(0, 300), code: e?.code ?? undefined };
  }
}

export const SKILL_FILES = ['payments-overview.md', 'reconcile-trainee-payments.md', 'create-and-send-payment-link.md', 'refunds-and-reversals.md', 'troubleshooting-errors.md'];
let skillsCache: string | null = null;
/** Skill markdown files, loaded once from agent/payment_tools/skills (cwd = app root in dev and on PM2). */
export function skillsPrompt(dir = path.join(process.cwd(), 'agent', 'payment_tools', 'skills')): string {
  if (skillsCache !== null) return skillsCache;
  const parts: string[] = [];
  for (const f of SKILL_FILES) {
    try { parts.push(fs.readFileSync(path.join(dir, f), 'utf8').trim()); } catch { /* missing file: skip */ }
  }
  skillsCache = parts.length ? `\n\n# مهارت‌های پرداخت (زرین‌پال)\n${parts.join('\n\n')}` : '';
  return skillsCache;
}
