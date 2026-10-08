// ============================================================
// Carla CRM — API Client (aligned with eco_v4 MySQL backend)
// Backend base: http://localhost:3001
// All field names match the actual MySQL schema used by
// C:\dev\eco_v4\apps\crm\backend\server.ts
// ============================================================

import {
  Course,
  Student,
  Enrollment,
  Payment,
  NationalCardOcrResult,
  ReceiptSettings,
  ReportTemplate,
  ReportContextResponse,
  Expense,
  WebsiteRegistration,
  StaffUser,
} from '../types';

function resolveApiOrigin(): string {
  const envOrigin = (import.meta as any).env?.VITE_API_ORIGIN as string | undefined;
  if (envOrigin) return envOrigin.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
    return 'https://crm.mmd30na.cloud';
  }
  return '';
}

const API_ORIGIN = resolveApiOrigin();
const API_BASE = `${API_ORIGIN}/api`;
const TOKEN_KEY = 'carla_crm_token';

export function getAuthToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setAuthToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    setAuthToken(null);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('carla-auth-lost'));
  }
  return res;
}

export async function login(username: string, password: string): Promise<{ token: string; user: { username: string; role?: string } }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'ورود ناموفق بود');
  if (!data.token) throw new Error('توکن دریافت نشد');
  setAuthToken(data.token);
  return data;
}

export async function fetchMe(): Promise<{ user: any; db?: string }> {
  const res = await apiFetch('/auth/me');
  if (!res.ok) throw new Error('Unauthorized');
  return res.json();
}

export function logout() {
  setAuthToken(null);
}

function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Uploaded files (/uploads, /StudentFiles) need a login. <img> and <a> cannot send an
 * Authorization header, so the session token is passed in the query string instead.
 */
function protectedFileUrl(path?: string | null): string | undefined {
  const url = fileUrl(path);
  const token = getAuthToken();
  if (!url || !token || typeof window === 'undefined') return url;
  try {
    const u = new URL(url, window.location.origin);
    const apiOrigin = new URL(API_ORIGIN || window.location.origin, window.location.origin).origin;
    if (u.origin !== apiOrigin || !/^\/(uploads|StudentFiles)\//.test(u.pathname)) return url;
    u.searchParams.set('token', token);
    return u.toString();
  } catch {
    return url;
  }
}

// ─────────────────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────────────────

/** GET /api/courses  →  backend returns { success, courses } */
export async function fetchCourses(): Promise<Course[]> {
  const res = await apiFetch(`/courses`);
  if (!res.ok) throw new Error('Error fetching courses');
  const body = await res.json();
  // Backend wraps in { success, courses } OR returns array directly (legacy)
  const raw: any[] = Array.isArray(body) ? body : (body.courses ?? body.data ?? []);
  // Normalise field names: backend uses price/title/course_id/is_active
  return raw.map(c => ({
    id:             c.course_id ?? c.id,
    title:          c.title,
    code:           c.code ?? c.title?.slice(0, 8).replace(/\s/g, '-').toUpperCase() ?? 'COURSE',
    tuition:        Number(c.price ?? c.tuition ?? 0),
    duration_weeks: Number(c.duration_days ? Math.ceil(c.duration_days / 7) : c.duration_weeks ?? 8),
    active:         c.is_active !== undefined ? !!c.is_active : c.active !== false,
  }));
}

export async function saveCourse(course: Course): Promise<Course> {
  const res = await apiFetch(`/courses/${course.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title:         course.title,
      price:         course.tuition,
      duration_days: course.duration_weeks ? course.duration_weeks * 7 : null,
      is_active:     course.active,
    }),
  });
  if (!res.ok) throw new Error('Error updating course');
  return course;
}

export async function addCourse(course: Omit<Course, 'id'>): Promise<Course> {
  const res = await apiFetch(`/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title:         course.title,
      price:         course.tuition,
      duration_days: course.duration_weeks ? course.duration_weeks * 7 : null,
    }),
  });
  if (!res.ok) throw new Error('Error adding course');
  const body = await res.json();
  return { ...course, id: body.insertId ?? body.id ?? Date.now() };
}

// ─────────────────────────────────────────────────────────
// STUDENTS
// ─────────────────────────────────────────────────────────

/** GET /api/students  →  { success, count, students } */
export async function fetchStudents(): Promise<Student[]> {
  const res = await apiFetch(`/students`);
  if (!res.ok) throw new Error('Error fetching students');
  const body = await res.json();
  const raw: any[] = Array.isArray(body) ? body : (body.students ?? []);
  return raw.map(normaliseStudent);
}

function normaliseStudent(s: any): Student {
  return {
    id:                 s.student_id ?? s.id,
    first_name:         s.first_name ?? '',
    last_name:          s.last_name ?? '',
    father_name:        s.father_name ?? '',
    national_code:      s.national_code ?? '',
    phone_number:       s.phone_number ?? '',
    birth_date_jalali:  s.birth_date_jalali ?? '',
    address:            s.address ?? '',
    id_card_photo_url:  protectedFileUrl(s.national_card_path || s.id_card_photo_url),
    personal_photo_url: protectedFileUrl(s.personal_photo_path || s.personal_photo_url),
    status:             (s.status ?? s.registration_status ?? 'active') as Student['status'],
    created_at:         s.created_at ?? new Date().toISOString(),
    // Extra fields from backend join (used in StudentsList)
    total_paid:         Number(s.total_paid    ?? 0),
    course_fee:         Number(s.course_fee    ?? s.final_price ?? 0),
    remaining_debt:     Number(s.remaining_debt ?? 0),
    category:           s.category ?? '',
    tracking_code:      s.tracking_code ?? '',
  } as Student;
}

export async function createStudent(body: {
  first_name: string;
  last_name: string;
  national_code?: string | null;
  phone_number?: string | null;
  father_name?: string | null;
  birth_date_jalali?: string | null;
  address?: string | null;
}): Promise<{ status: string; student: Student }> {
  const res = await apiFetch(`/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Error creating student');
  }
  const data = await res.json();
  return { status: 'success', student: normaliseStudent(data.student ?? data) };
}

export async function updateStudent(student: Student): Promise<Student> {
  const res = await apiFetch(`/students/${student.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(student),
  });
  if (!res.ok) throw new Error('Error updating student');
  const data = await res.json();
  return normaliseStudent(data.student ?? data);
}

export async function deleteStudentCascade(studentId: number): Promise<{ success: boolean }> {
  const res = await apiFetch(`/students/${studentId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Error deleting student');
  return res.json();
}

/**
 * Upload national card / personal photo for a student.
 * Backend eco_v4 doesn't have /students/:id/photos, so we send to
 * /api/students/ocr/national-card for the card scan flow and
 * skip uploading personal photo separately (stored during registration).
 * For now we POST multipart to backend's register-upload endpoint.
 */
export async function uploadStudentPhotos(
  studentId: number,
  files: { idCard?: File | null; personal?: File | null },
  meta?: { last_name?: string; course_number?: number | null }
): Promise<Student> {
  const formData = new FormData();
  formData.append('student_id', String(studentId));
  if (meta?.last_name) formData.append('last_name', meta.last_name);
  if (meta?.course_number != null) formData.append('course_number', String(meta.course_number));
  if (files.idCard)   formData.append('idCard',    files.idCard);
  if (files.personal) formData.append('personal',  files.personal);

  const res = await apiFetch(`/students/${studentId}/photos`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'بارگذاری عکس ناموفق بود');
  }
  const data = await res.json();
  return normaliseStudent(data.student ?? data);
}

export async function fetchRegistrations(): Promise<WebsiteRegistration[]> {
  const res = await apiFetch(`/registrations`);
  if (!res.ok) throw new Error('Error fetching registrations');
  const body = await res.json();
  const raw: any[] = Array.isArray(body) ? body : (body.registrations ?? body.data ?? []);
  return raw.map((r) => ({
    id: r.registration_id ?? r.id,
    tracking_code: r.tracking_code ?? '',
    national_code: r.national_code ?? '',
    full_name: r.full_name ?? '',
    phone_number: r.phone_number ?? '',
    category: r.category ?? '',
    academic_degree: r.academic_degree ?? '',
    military_status: r.military_status ?? '',
    has_temp_permit: r.has_temp_permit,
    national_card_path: protectedFileUrl(r.national_card_path),
    personal_photo_path: protectedFileUrl(r.personal_photo_path),
    status: r.status ?? 'pending',
    source: r.source ?? 'website',
    student_id: r.student_id ?? null,
    created_at: r.created_at,
  }));
}

export async function approveRegistration(registrationId: number, studentId: number): Promise<WebsiteRegistration> {
  const res = await apiFetch(`/registrations/${registrationId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'تایید ثبت‌نام وبسایت ناموفق بود');
  }
  const data = await res.json();
  return data.registration ?? data;
}

// ─────────────────────────────────────────────────────────
// ENROLLMENTS
// ─────────────────────────────────────────────────────────

/** GET /api/enrollments  →  backend returns array */
export async function fetchEnrollments(): Promise<Enrollment[]> {
  const res = await apiFetch(`/enrollments`);
  if (!res.ok) throw new Error('Error fetching enrollments');
  const body = await res.json();
  const raw: any[] = Array.isArray(body) ? body : (body.enrollments ?? body.data ?? []);
  return raw.map(e => ({
    id:                  e.enrollment_id ?? e.id,
    student_id:          e.student_id,
    course_id:           e.course_id,
    course_number:       e.course_number ?? null,
    signup_date_jalali:  e.signup_date_jalali ?? e.enrolled_at ?? '',
    final_price:         Number(e.final_price ?? 0),
    receipt_pdf_path:    protectedFileUrl(e.receipt_pdf_path),
  }));
}

export async function createEnrollment(body: {
  student_id: number;
  course_id: number;
  course_number?: number | null;
  signup_date_jalali?: string;
  final_price?: number;
}): Promise<Enrollment> {
  const res = await apiFetch(`/enrollments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Error creating enrollment');
  }
  const data = await res.json();
  return {
    id:                 data.enrollment_id ?? data.id ?? Date.now(),
    student_id:         data.student_id ?? body.student_id,
    course_id:          data.course_id ?? body.course_id,
    course_number:      data.course_number ?? body.course_number ?? null,
    signup_date_jalali: data.signup_date_jalali ?? body.signup_date_jalali ?? '',
    final_price:        Number(data.final_price ?? body.final_price ?? 0),
  };
}

// ─────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────

/** GET /api/payments  →  backend returns array or { success, payments } */
export async function fetchPayments(): Promise<Payment[]> {
  const res = await apiFetch(`/payments`);
  if (!res.ok) throw new Error('Error fetching payments');
  const body = await res.json();
  const raw: any[] = Array.isArray(body) ? body : (body.payments ?? body.data ?? []);
  return raw.map(p => ({
    id:            p.payment_id ?? p.id,
    student_id:    p.student_id,
    enrollment_id: p.enrollment_id ?? null,
    amount:        Number(p.amount ?? 0),
    pay_date_jalali: p.pay_date_jalali ?? p.payment_date?.slice(0, 10) ?? '',
    pay_method:    p.payment_method ?? p.pay_method ?? 'cash',
    payment_kind:  p.payment_kind ?? 'installment',
    description:   p.notes ?? p.description ?? '',
  }));
}

export async function createPayment(body: {
  student_id: number;
  enrollment_id?: number | null;
  amount: number;
  pay_date_jalali?: string;
  pay_method?: string | null;
  payment_kind?: string | null;
  description?: string | null;
}): Promise<Payment> {
  const res = await apiFetch(`/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      student_id:     body.student_id,
      enrollment_id:  body.enrollment_id ?? null,
      amount:         body.amount,
      pay_date_jalali: body.pay_date_jalali,
      pay_method:     body.pay_method ?? 'cash',
      payment_kind:   body.payment_kind ?? 'installment',
      description:    body.description ?? '',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Error creating payment');
  }
  return {
    id:            Date.now(),
    student_id:    body.student_id,
    enrollment_id: body.enrollment_id ?? null,
    amount:        body.amount,
    pay_date_jalali: body.pay_date_jalali ?? new Date().toLocaleDateString('fa-IR'),
    pay_method:    body.pay_method ?? 'cash',
    payment_kind:  body.payment_kind ?? 'installment',
    description:   body.description ?? '',
  };
}

// ─────────────────────────────────────────────────────────
// EXPENSES
// ─────────────────────────────────────────────────────────

/** GET /api/expenses  →  { success, count, expenses } */
export async function fetchExpenses(): Promise<Expense[]> {
  const res = await apiFetch(`/expenses`);
  if (!res.ok) throw new Error('Error fetching expenses');
  const body = await res.json();
  const raw: any[] = Array.isArray(body) ? body : (body.expenses ?? body.data ?? []);
  return raw.map(ex => ({
    id:                  ex.expense_id ?? ex.id,
    title:               ex.title ?? '',
    amount:              Number(ex.amount ?? 0),
    pay_method:          ex.category ?? ex.pay_method ?? 'عمومی',
    pay_date_jalali:     ex.expense_date_jalali ?? ex.expense_date ?? ex.pay_date_jalali ?? '',
    description:         ex.notes ?? ex.description ?? '',
    category:            ex.category ?? '',
    expense_date:        ex.expense_date ?? '',
  }));
}

export async function createExpense(body: {
  title: string;
  amount: number;
  pay_method?: string;
  pay_date_jalali?: string;
  description?: string;
  category?: string;
}): Promise<Expense> {
  const res = await apiFetch(`/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title:            body.title,
      amount:           body.amount,
      pay_method:       body.pay_method ?? body.category ?? 'عمومی',
      pay_date_jalali:  body.pay_date_jalali,
      description:      body.description ?? '',
      category:         body.category ?? body.pay_method ?? 'عمومی',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Error logging expense');
  }
  return {
    id:             Date.now(),
    title:          body.title,
    amount:         body.amount,
    pay_method:     body.pay_method ?? 'عمومی',
    pay_date_jalali: body.pay_date_jalali ?? new Date().toLocaleDateString('fa-IR'),
    description:    body.description ?? '',
  };
}

// ─────────────────────────────────────────────────────────
// OCR
// ─────────────────────────────────────────────────────────

/** POST /api/students/ocr/national-card */
export async function ocrNationalCard(file: File): Promise<NationalCardOcrResult> {
  const formData = new FormData();
  formData.append('card', file);
  formData.append('nationalCard', file);

  const res = await apiFetch(`/ocr`, {
    method: 'POST',
    body:   formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطا در اسکن کارت ملی');
  return {
    first_name:        data.first_name ?? '',
    last_name:         data.last_name ?? '',
    national_code:     data.national_code ?? '',
    father_name:       data.father_name ?? '',
    birth_date_jalali: data.birth_date_jalali ?? '',
    confidence:        data.confidence ?? 0.9,
  };
}

// ─────────────────────────────────────────────────────────
// RECEIPT SETTINGS  (stored in academy_settings table)
// ─────────────────────────────────────────────────────────

export async function fetchReceiptSettings(): Promise<ReceiptSettings> {
  const res = await apiFetch(`/receipt-settings`);
  if (!res.ok) throw new Error('Error fetching receipt settings');
  const body = await res.json();
  const d = body.data ?? body;
  return {
    academy_name: d.academy_name ?? d.name ?? 'آموزشگاه رانندگی کارلا',
    logo_url:     d.logo_url ?? '',
    phone_number: d.phone_number ?? d.phone ?? '',
    address:      d.address ?? '',
    header_text:  d.header_text ?? d.receipt_header ?? '',
    footer_text:  d.footer_text ?? d.receipt_footer ?? '',
  };
}

export async function saveReceiptSettings(settings: ReceiptSettings): Promise<ReceiptSettings> {
  const res = await apiFetch(`/receipt-settings`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      academy_name: settings.academy_name,
      logo_url:     settings.logo_url,
      phone_number: settings.phone_number,
      address:      settings.address,
      header_text:  settings.header_text,
      footer_text:  settings.footer_text,
    }),
  });
  if (!res.ok) throw new Error('Error saving receipt settings');
  return settings;
}

// ─────────────────────────────────────────────────────────
// REPORT TEMPLATES
// ─────────────────────────────────────────────────────────

export async function fetchReportTemplates(opts?: {
  category?: string;
  active?: boolean;
  includeBody?: boolean;
}): Promise<{ templates: ReportTemplate[]; fallback?: boolean }> {
  // eco_v4 backend exposes /api/report-templates
  const query = new URLSearchParams();
  if (opts?.category)               query.append('category',    opts.category);
  if (opts?.active !== undefined)   query.append('active',      String(opts.active));
  if (opts?.includeBody !== undefined) query.append('includeBody', String(opts.includeBody));

  const res = await apiFetch(`/report-templates?${query.toString()}`);
  if (!res.ok) {
    // Graceful fallback
    return { templates: [], fallback: true };
  }
  const body = await res.json();
  return { templates: body.templates ?? [], fallback: !!body.fallback };
}

export async function fetchEnrollmentReportContext(
  enrollmentId: number | string
): Promise<ReportContextResponse> {
  const res = await apiFetch(`/enrollments/${enrollmentId}/report-context`);
  if (!res.ok) throw new Error('Error fetching report context');
  return res.json();
}

export async function uploadEnrollmentReceipt(
  enrollmentId: number | string,
  pdf: Blob,
  opts?: { template_key?: string; paper_size?: string; filename?: string }
): Promise<{ receipt_pdf_path: string }> {
  const formData = new FormData();
  formData.append('pdf', pdf, opts?.filename || `receipt_${enrollmentId}.pdf`);
  if (opts?.template_key) formData.append('template_key', opts.template_key);
  if (opts?.paper_size)   formData.append('paper_size',   opts.paper_size);

  const res = await apiFetch(`/enrollments/${enrollmentId}/receipt`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) {
    // Non-critical — receipt upload failure shouldn't block registration
    return { receipt_pdf_path: '' };
  }
  const data = await res.json();
  return { receipt_pdf_path: protectedFileUrl(data.receipt_pdf_path) ?? '' };
}

// ─────────────────────────────────────────────────────────
// GATEWAYS (RUBIKA & SMS.IR)
// ─────────────────────────────────────────────────────────

export async function fetchGatewaySettings(): Promise<{
  sms_provider: string;
  sms_api_key: string;
  sms_sender_line: string;
  sms_auto_register: boolean;
  rubika_bot_token: string;
  rubika_channel_id: string;
  rubika_active: boolean;
}> {
  const res = await apiFetch(`/settings/gateways`);
  if (!res.ok) throw new Error('Error fetching gateway settings');
  const body = await res.json();
  return body.data ?? body;
}

export async function saveGatewaySettings(settings: {
  sms_provider?: string;
  sms_api_key?: string;
  sms_sender_line?: string;
  sms_auto_register?: boolean;
  rubika_bot_token?: string;
  rubika_channel_id?: string;
  rubika_active?: boolean;
}): Promise<{ success: boolean }> {
  const res = await apiFetch(`/settings/gateways`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Error saving gateway settings');
  return res.json();
}

export async function sendMessengerMessage(body: {
  channel: 'rubika' | 'sms' | 'bale' | 'eitaa' | string;
  recipient: string;
  messageText: string;
  templateTitle?: string;
}): Promise<{ success: boolean; result: any }> {
  const res = await apiFetch(`/messenger/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: body.channel,
      recipient: body.recipient,
      message: body.messageText,
      messageText: body.messageText,
      templateTitle: body.templateTitle,
    }),
  });
  if (!res.ok) throw new Error('Error sending messenger message');
  return res.json();
}

export async function fetchMessengerThreads(): Promise<any[]> {
  const res = await apiFetch(`/messenger/threads`);
  if (!res.ok) return [];
  const body = await res.json();
  return body.threads ?? [];
}

export async function fetchMessengerMessages(): Promise<any[]> {
  try {
    const res = await apiFetch(`/messenger/messages`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}

export async function fetchStaffUsers(): Promise<StaffUser[]> {
  const res = await apiFetch('/staff');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'دریافت کاربران ناموفق بود');
  return Array.isArray(data.users) ? data.users : [];
}

export async function createStaffUser(body: {
  username: string;
  full_name: string;
  password: string;
  role: StaffUser['role'];
  is_active?: boolean;
}): Promise<StaffUser> {
  const res = await apiFetch('/staff', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'ایجاد کاربر ناموفق بود');
  return data.user;
}

export async function updateStaffUser(id: number, body: {
  full_name?: string;
  role?: StaffUser['role'];
  is_active?: boolean;
  password?: string;
}): Promise<StaffUser> {
  const res = await apiFetch(`/staff/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'بروزرسانی کاربر ناموفق بود');
  return data.user;
}


export async function saveGateways(gateways: any) {
  const res = await apiFetch('/settings/gateways', {
    method: 'POST',
    body: JSON.stringify(gateways),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'خطا در ذخیرهسازی درگاهها');
  }
  return res.json();
}

export async function syncDb() {
  const res = await apiFetch('/db/sync', { method: 'POST' });
  if (!res.ok) throw new Error('خطا در همگامسازی');
  return res.json();
}

export async function sendSms(payload: any) {
  const res = await apiFetch('/sms/send', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('خطا در ارسال پیامک');
  return res.json();
}
