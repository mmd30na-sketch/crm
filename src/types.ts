// ============================================================
// Carla CRM — Shared TypeScript types
// Aligned with eco_v4 MySQL backend (C:\dev\eco_v4\apps\crm\backend)
// ============================================================

export interface Course {
  id: number;
  title: string;
  code: string;
  tuition: number;        // maps to MySQL: price
  duration_weeks: number; // derived from duration_days / 7
  active: boolean;        // maps to MySQL: is_active
}

export interface Student {
  id: number;
  first_name: string;
  last_name: string;
  father_name?: string;
  national_code: string;
  phone_number: string;
  birth_date_jalali?: string;
  address?: string;
  id_card_photo_url?: string;   // from national_card_path
  personal_photo_url?: string;  // from personal_photo_path
  status: 'active' | 'suspended' | 'graduated' | 'pending';
  created_at: string;

  // Extra joined fields from GET /api/students (MySQL JOIN)
  total_paid?: number;
  course_fee?: number;
  remaining_debt?: number;
  category?: string;
  tracking_code?: string;
}

export interface Enrollment {
  id: number;
  student_id: number;
  course_id: number;
  course_number?: number | null;
  signup_date_jalali: string;
  final_price: number;
  receipt_pdf_path?: string;
}

export interface Payment {
  id: number;
  student_id: number;
  enrollment_id?: number | null;
  amount: number;
  pay_date_jalali: string;     // normalised from payment_date
  pay_method: 'cash' | 'pos' | 'card_transfer' | string;
  payment_kind: 'downpayment' | 'full' | 'installment' | string;
  description?: string;
}

export interface Expense {
  id: number;
  title: string;
  amount: number;
  pay_method: string;       // mapped from category
  pay_date_jalali: string;  // normalised from expense_date
  description?: string;
  category?: string;
  expense_date?: string;    // raw from backend
}

export interface NationalCardOcrResult {
  first_name: string;
  last_name: string;
  national_code: string;
  father_name: string;
  birth_date_jalali: string;
  confidence: number;
}

export interface ReceiptSettings {
  academy_name: string;
  logo_url?: string;
  phone_number: string;
  address: string;
  header_text?: string;
  footer_text?: string;
}

export interface ReportTemplate {
  key: string;
  title: string;
  category: 'receipt' | 'contract' | 'report';
  body?: string;
  active: boolean;
}

export interface ReportContextResponse {
  enrollment: Enrollment;
  student: Student;
  course: Course;
  payments: Payment[];
  settings: ReceiptSettings;
  timestamp: string;
}
