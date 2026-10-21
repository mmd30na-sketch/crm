import type { Course } from '../types';

/** Website category -> CRM course id (same map as StudentRegistrationForm) and a Persian fallback label. */
export const REGISTRATION_CATEGORY: Record<string, { id: number; label: string }> = {
  cargo_freight: { id: 1, label: 'حمل‌ونقل جاده‌ای (بار)' },
  hazardous_materials: { id: 2, label: 'حمل مواد خطرناک' },
  passenger_bus: { id: 3, label: 'حمل‌ونقل مسافر' },
  passenger_transport: { id: 3, label: 'حمل‌ونقل مسافر' },
  ceo_company: { id: 4, label: 'مدیر شرکت حمل‌ونقل' },
  ceo_freight: { id: 4, label: 'مدیر شرکت حمل‌ونقل' },
  ceo_passenger: { id: 5, label: 'مدیر شرکت مسافربری' },
  technical_manager: { id: 6, label: 'مسئول فنی' },
};

/** Persian course name for a website category: CRM course title when known, else the fallback label. */
export function registrationCourseName(category: string | undefined, courses: Course[] = []): string {
  const e = REGISTRATION_CATEGORY[String(category || '')];
  if (!e) return category || '—';
  return courses.find((c) => Number(c.id) === e.id)?.title || e.label;
}

/** MySQL datetimes are UTC; Jalali date and time in Tehran. */
export function tehranDate(v?: string | null): string {
  if (!v) return '—';
  const s = String(v).replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
