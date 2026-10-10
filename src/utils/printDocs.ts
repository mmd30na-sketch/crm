/**
 * Pure logic of the three registration documents (Receipt, IDCard = file summary, Contract):
 * file names, storage paths, receipt number, field mapping and contract text.
 * Shared by the browser (src/components/print) and the server (server.ts); no DOM/Node imports so it can be
 * unit-tested with `node --import tsx` (scripts/test-print-docs.mjs).
 */

export type DocKind = 'Receipt' | 'IDCard' | 'Contract';
export const DOC_KINDS: readonly DocKind[] = ['Receipt', 'IDCard', 'Contract'];

export const DOC_LABELS: Record<DocKind, string> = {
  Receipt: 'رسید ثبت‌نام',
  IDCard: 'برگ خلاصه پرونده',
  Contract: 'قرارداد آموزشی',
};

/** Enrollment column that stores the PDF path of each kind (Receipt reuses the pre-existing column). */
export const DOC_PATH_FIELDS: Record<DocKind, 'receipt_pdf_path' | 'idcard_pdf_path' | 'contract_pdf_path'> = {
  Receipt: 'receipt_pdf_path',
  IDCard: 'idcard_pdf_path',
  Contract: 'contract_pdf_path',
};

export function parseDocKind(v: unknown): DocKind | null {
  const s = String(v ?? '').trim().toLowerCase();
  return DOC_KINDS.find((k) => k.toLowerCase() === s) ?? null;
}

/** A single safe path segment: Persian/Latin letters, digits, `._-`; never empty and never `.`/`..`. */
export function safeSegment(value: unknown, fallback: string): string {
  const raw = String(value || fallback).trim() || fallback;
  const clean = raw.replace(/[^؀-ۿa-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return !clean || /^\.+$/.test(clean) ? fallback : clean;
}

/**
 * StudentFiles/<course number>/<LastName>_<id>/<LastName>_<id>_<Kind>.pdf  (relative to the project root, no leading slash).
 * Same folder rule the photo upload uses, so a student's photos and documents sit together.
 */
export function registrationPdfRelPath(p: { courseNumber: unknown; lastName: unknown; studentId: unknown; kind: DocKind }) {
  const dir = `${safeSegment(p.courseNumber, 'unsorted')}/${safeSegment(p.lastName, 'Student')}_${safeSegment(p.studentId, 'x')}`;
  const base = `${safeSegment(p.lastName, 'Student')}_${safeSegment(p.studentId, 'x')}_${p.kind}`;
  return { dir: `StudentFiles/${dir}`, base, file: `${base}.pdf`, path: `StudentFiles/${dir}/${base}.pdf` };
}

/** Download name offered to the user (ASCII-safe prefix not required; browsers accept Persian). */
export function downloadFileName(lastName: unknown, studentId: unknown, kind: DocKind): string {
  return `${safeSegment(lastName, 'Student')}_${safeSegment(studentId, 'x')}_${kind}.pdf`;
}

/** %PDF- magic bytes check on the first bytes of an upload. */
export function isPdfBytes(head: Uint8Array | Buffer): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return head.length >= 5 && magic.every((b, i) => head[i] === b);
}

/**
 * The one place that decides the number printed as "شماره رسید" on all three documents: the enrollment's own id
 * (no separate sequence is kept in the database). The course number is a different thing and is printed on its own.
 */
export function receiptNumber(enrollment: { id?: number | string | null } | null | undefined): string {
  const id = Number(enrollment?.id);
  return Number.isFinite(id) && id > 0 ? String(Math.trunc(id)) : '';
}

const PERSIAN_ZERO = 0x06F0;
export function toPersianDigits(v: string | number): string {
  return String(v).replace(/\d/g, (d) => String.fromCharCode(PERSIAN_ZERO + Number(d)));
}

/** 1250000 -> "۱٬۲۵۰٬۰۰۰" (deterministic, independent of the runtime's ICU data). */
export function formatAmount(n: number | null | undefined): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return toPersianDigits(String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
}

export const DEFAULT_CONTRACT_TEXT = [
  'شهریه پرداختی (بیعانه یا تسویه) پس از ثبت‌نام قطعی و شروع کلاس‌بندی به هیچ وجه مسترد نمی‌گردد.',
  'کارآموز متعهد به حضور منظم در کلاس‌هاست؛ غیبت بیش از حد مجاز طبق آیین‌نامه، موجب حذف از دوره و عدم معرفی به آزمون خواهد شد.',
  'آموزشگاه هیچ‌گونه مسئولیتی در قبال قبولی یا مردودی کارآموز در آزمون‌های فنی و حرفه‌ای ندارد.',
  'هزینه‌های ثبت‌نام آزمون، صدور گواهینامه و آزمون‌های مجدد، جدا از شهریه آموزشی بوده و بر عهده کارآموز است.',
  'تسویه حساب مالی کامل باید پیش از معرفی به آزمون انجام شود، در غیر این صورت کارت ورود به جلسه صادر نخواهد شد.',
].join('\n');

export const CONTRACT_TOKENS = ['academy_name', 'student_name', 'national_code', 'course_title', 'course_number', 'tuition', 'paid', 'date'] as const;

/**
 * Contract text from the settings (one clause per line; leading numbering like "۱." or "2-" is stripped because the
 * document numbers the clauses itself; {{tokens}} are replaced). Empty text falls back to the default.
 */
export function contractClauses(text: unknown, vars: Partial<Record<(typeof CONTRACT_TOKENS)[number], string>> = {}): string[] {
  const source = typeof text === 'string' && text.trim() ? text : DEFAULT_CONTRACT_TEXT;
  return source
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key as keyof typeof vars] ?? '')
      .replace(/^\s*(?:[0-9۰-۹٠-٩]+\s*[.\-)٫،:]|[•\-*])\s*/, '')
      .trim())
    .filter(Boolean);
}

export interface DocSettings {
  academy_name?: string;
  logo_url?: string;
  phone_number?: string;
  address?: string;
  header_text?: string;
  footer_text?: string;
  contract_text?: string;
}

export interface DocData {
  academy: { name: string; phone: string; address: string; header: string; footer: string; logoUrl: string };
  receiptNumber: string;
  courseNumber: string;
  /** Jalali date printed on the documents. */
  date: string;
  student: { firstName: string; lastName: string; fullName: string; nationalCode: string; mobile: string; fatherName: string };
  courseTitle: string;
  money: { tuition: number; paid: number; remaining: number; settled: boolean; statusText: string };
  images: { personal: string | null; nationalCard: string | null };
  contractClauses: string[];
}

export interface BuildDocInput {
  student: { first_name?: string; last_name?: string; national_code?: string; phone_number?: string; father_name?: string };
  enrollment: { id?: number | string | null; course_number?: number | string | null; final_price?: number | null };
  course?: { title?: string; tuition?: number } | null;
  /** Payments of THIS enrollment (or the already summed amount). */
  payments?: Array<{ amount: number }> | null;
  paid?: number;
  settings?: DocSettings | null;
  images?: { personal?: string | null; nationalCard?: string | null };
  date: string;
}

export function paymentSummary(tuition: number, paid: number) {
  const t = Math.max(0, Math.round(Number(tuition) || 0));
  const p = Math.max(0, Math.round(Number(paid) || 0));
  const remaining = Math.max(0, t - p);
  const settled = remaining === 0;
  return { tuition: t, paid: p, remaining, settled, statusText: settled ? 'تسویه کامل' : `مانده: ${formatAmount(remaining)} تومان` };
}

export const DEFAULT_ACADEMY_NAME = 'آموزشگاه رانندگی کارلا';

export function buildDocData(input: BuildDocInput): DocData {
  const { student, enrollment, course, settings, images } = input;
  const firstName = String(student.first_name ?? '').trim();
  const lastName = String(student.last_name ?? '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const tuition = Number(enrollment.final_price) || Number(course?.tuition) || 0;
  const paid = input.paid ?? (input.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const money = paymentSummary(tuition, paid);
  const courseNumber = enrollment.course_number != null && String(enrollment.course_number) !== '' ? String(enrollment.course_number) : '';
  const academyName = String(settings?.academy_name ?? '').trim() || DEFAULT_ACADEMY_NAME;
  const courseTitle = String(course?.title ?? '').trim();
  const nationalCode = String(student.national_code ?? '').trim();
  return {
    academy: {
      name: academyName,
      phone: String(settings?.phone_number ?? '').trim(),
      address: String(settings?.address ?? '').trim(),
      header: String(settings?.header_text ?? '').trim(),
      footer: String(settings?.footer_text ?? '').trim(),
      logoUrl: String(settings?.logo_url ?? '').trim(),
    },
    receiptNumber: receiptNumber(enrollment),
    courseNumber,
    date: input.date,
    student: { firstName, lastName, fullName, nationalCode, mobile: String(student.phone_number ?? '').trim(), fatherName: String(student.father_name ?? '').trim() },
    courseTitle,
    money,
    images: { personal: images?.personal || null, nationalCard: images?.nationalCard || null },
    contractClauses: contractClauses(settings?.contract_text, {
      academy_name: academyName,
      student_name: fullName,
      national_code: nationalCode,
      course_title: courseTitle,
      course_number: courseNumber,
      tuition: formatAmount(money.tuition),
      paid: formatAmount(money.paid),
      date: input.date,
    }),
  };
}

/** Visible warnings for missing inputs (shown in the preview, never block registration). */
export function docWarnings(data: DocData): string[] {
  const w: string[] = [];
  if (!data.images.personal) w.push('عکس پرسنلی ثبت نشده است؛ در برگ خلاصه پرونده کادر خالی چاپ می‌شود.');
  if (!data.images.nationalCard) w.push('تصویر کارت ملی ثبت نشده است؛ در برگ خلاصه پرونده کادر خالی چاپ می‌شود.');
  if (!data.courseTitle) w.push('عنوان دوره مشخص نیست.');
  if (!data.receiptNumber) w.push('شماره رسید مشخص نیست.');
  return w;
}
