import type { ZarinpalClient } from '../client';

export type ToolCtx = { username: string; role: string };

/** A mutating action is never executed by the tool: it is queued and runs only after an admin «تأیید». */
export type PaymentAction =
  | { kind: 'reverse'; authority: string; amount_toman: number | null; status: string }
  | { kind: 'refund'; session_id: string; amount_rial: number; description: string; card: string };

export type PaymentToolDeps = {
  client: ZarinpalClient;
  /** Debt-link store (debtSms.ts): the same links the trainee payment page and SMS use. */
  links: {
    createLink: (studentId: number, amount: number, expiresAt: string | null) => Promise<{ code: string; amount: number; expires_at: string | null }>;
    studentInfo: (studentId: number) => Promise<{ first_name: string; last_name: string; phone_number: string } | null>;
    studentDebt: (studentId: number) => Promise<number>;
  };
  /** Effective CRM_PAYMENT_LINK_BASE (Settings → درگاه پرداخت, env, default); the code is appended. */
  paymentLinkBase: () => string;
  /** Queues a confirmation (the same pending/«تأیید» mechanism as Telegram/Rubika). */
  queueConfirmation: (ctx: ToolCtx, action: PaymentAction, label: string, summary: string) => { pending_id: string; preview: string };
  now?: () => Date;
};

export type JsonSchema = { type: 'object'; properties: Record<string, any>; required?: string[]; additionalProperties?: boolean };

export interface PaymentTool {
  name: string;
  /** Persian description shown to the model. */
  description: string;
  parameters: JsonSchema;
  /** Mutating tools only queue an action for admin confirmation. */
  mutating?: boolean;
  handler: (args: any, ctx: ToolCtx, deps: PaymentToolDeps) => Promise<any>;
}
