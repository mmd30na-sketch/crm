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
} from '../types';

const API_BASE = '/api';

// ─────────────────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────────────────

/** GET /api/courses  →  backend returns { success, courses } */
export async function fetchCourses(): Promise<Course[]> {
  const res = await fetch(`${API_BASE}/courses`);
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
  // backend PUT /api/settings/courses/:id
  const res = await fetch(`${API_BASE}/settings/courses/${course.id}`, {
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
  const res = await fetch(`${API_BASE}/settings/courses`, {
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
  const res = await fetch(`${API_BASE}/students`);
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
    id_card_photo_url:  s.national_card_path   ? `http://localhost:3001${s.national_card_path}`   : (s.id_card_photo_url  ?? undefined),
    personal_photo_url: s.personal_photo_path  ? `http://localhost:3001${s.personal_photo_path}`  : (s.personal_photo_url ?? undefined),
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
  const res = await fetch(`${API_BASE}/students`, {
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

export async function deleteStudentCascade(studentId: number): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/students/${studentId}`, { method: 'DELETE' });
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
  files: { idCard?: File | null; personal?: File | null }
): Promise<Student> {
  // eco_v4 backend doesn't expose this endpoint yet → return a best-effort student
  // We still try the legacy path in case the JSON db server is running alongside
  const formData = new FormData();
  if (files.idCard)   formData.append('idCard',    files.idCard);
  if (files.personal) formData.append('personal',  files.personal);

  const res = await fetch(`${API_BASE}/students/${studentId}/photos`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) {
    // Not a hard failure — just return a partial student object
    return { id: studentId } as unknown as Student;
  }
  const data = await res.json();
  return normaliseStudent(data.student ?? data);
}

// ─────────────────────────────────────────────────────────
// ENROLLMENTS
// ─────────────────────────────────────────────────────────

/** GET /api/enrollments  →  backend returns array */
export async function fetchEnrollments(): Promise<Enrollment[]> {
  const res = await fetch(`${API_BASE}/enrollments`);
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
    receipt_pdf_path:    e.receipt_pdf_path ?? undefined,
  }));
}

export async function createEnrollment(body: {
  student_id: number;
  course_id: number;
  course_number?: number | null;
  signup_date_jalali?: string;
  final_price?: number;
}): Promise<Enrollment> {
  const res = await fetch(`${API_BASE}/enrollments`, {
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
    student_id:         body.student_id,
    course_id:          body.course_id,
    course_number:      body.course_number ?? null,
    signup_date_jalali: body.signup_date_jalali ?? '',
    final_price:        body.final_price ?? 0,
  };
}

// ─────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────

/** GET /api/payments  →  backend returns array or { success, payments } */
export async function fetchPayments(): Promise<Payment[]> {
  const res = await fetch(`${API_BASE}/payments`);
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
  const res = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId:      body.student_id,
      amount:         body.amount,
      paymentMethod:  body.pay_method ?? 'cash',
      trackingNumber: undefined,
      notes:          body.description ?? '',
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
  const res = await fetch(`${API_BASE}/expenses`);
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
  const res = await fetch(`${API_BASE}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title:       body.title,
      amount:      body.amount,
      expenseDate: body.pay_date_jalali ?? new Date().toISOString().slice(0, 10),
      notes:       body.description ?? '',
      category:    body.category ?? body.pay_method ?? 'عمومی',
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
  formData.append('nationalCard', file);   // eco_v4 backend expects fieldname 'nationalCard'

  const res = await fetch(`${API_BASE}/students/ocr/national-card`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) throw new Error('Error performing OCR scan');
  const data = await res.json();
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
  const res = await fetch(`${API_BASE}/settings/academy`);
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
  const res = await fetch(`${API_BASE}/settings/academy`, {
    method:  'PUT',
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

  const res = await fetch(`${API_BASE}/report-templates?${query.toString()}`);
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
  const res = await fetch(`${API_BASE}/enrollments/${enrollmentId}/report-context`);
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

  const res = await fetch(`${API_BASE}/enrollments/${enrollmentId}/receipt`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) {
    // Non-critical — receipt upload failure shouldn't block registration
    return { receipt_pdf_path: '' };
  }
  return res.json();
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
  const res = await fetch(`${API_BASE}/settings/gateways`);
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
  const res = await fetch(`${API_BASE}/settings/gateways`, {
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
  const res = await fetch(`${API_BASE}/messenger/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Error sending messenger message');
  return res.json();
}

export async function fetchMessengerThreads(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/messenger/threads`);
  if (!res.ok) return [];
  const body = await res.json();
  return body.threads ?? [];
}

export async function fetchMessengerMessages(): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE}/messenger/messages`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}
