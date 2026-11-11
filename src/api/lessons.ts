import { getAuthToken } from './client';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const t = getAuthToken(); if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as any)?.error || `خطا ${res.status}`), { data, status: res.status });
  return data as T;
}

export type Vehicle = {
  id: number;
  name: string;
  plate?: string;
  kind: 'car' | 'motorcycle' | 'other';
  gearbox?: 'manual' | 'automatic';
  active: boolean;
  notes?: string;
};

export type LessonInstructor = {
  id: number;
  name: string;
  active: boolean;
};

export type Availability = {
  id: number;
  instructor_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
};

export type Booking = {
  id: number;
  student_id: number;
  student_name: string;
  phone_masked: string;
  instructor_id: number;
  instructor_name: string;
  vehicle_id?: number;
  vehicle_name?: string;
  lesson_date: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  notes?: string;
  cancel_reason?: string;
  reminder_status?: string;
  reminder_sent_at?: string;
  instructor_session_id?: number;
};

export type Conflict = {
  kind: 'instructor' | 'vehicle' | 'student';
  booking_id: number;
  lesson_date: string;
  start_time: string;
  end_time: string;
};

export type BookingInput = {
  student_id: number;
  instructor_id: number;
  vehicle_id?: number | null;
  lesson_date: string;
  start_time: string;
  end_time: string;
  notes?: string;
  force_outside_availability?: boolean;
};

export type ReminderConfig = {
  enabled: boolean;
  hours_before: number;
  template_key: string;
  template_id: string;
  test_mobile_masked: string;
  sms_configured: boolean;
};

export type BookingStatus = 'scheduled' | 'done' | 'cancelled' | 'no_show';

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  scheduled: 'رزرو شده',
  done: 'برگزار شد',
  cancelled: 'لغو شد',
  no_show: 'غیبت',
};

export const WEEKDAY_LABELS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

export const VEHICLE_KIND_LABEL: Record<Vehicle['kind'], string> = {
  car: 'خودرو',
  motorcycle: 'موتورسیکلت',
  other: 'سایر',
};

export async function listVehicles(): Promise<Vehicle[]> {
  return call('/lessons/vehicles');
}

export async function createVehicle(data: Omit<Vehicle, 'id'>): Promise<{ id: number }> {
  return call('/lessons/vehicles', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateVehicle(id: number, data: Partial<Omit<Vehicle, 'id'>>): Promise<{ ok: true }> {
  return call(`/lessons/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteVehicle(id: number): Promise<{ ok: true }> {
  return call(`/lessons/vehicles/${id}`, { method: 'DELETE' });
}

export async function listInstructors(): Promise<LessonInstructor[]> {
  return call('/lessons/instructors');
}

export async function listAvailability(instructor_id?: number): Promise<Availability[]> {
  const params = new URLSearchParams();
  if (instructor_id) params.set('instructor_id', String(instructor_id));
  return call(`/lessons/availability?${params.toString()}`);
}

export async function createAvailability(data: Omit<Availability, 'id'>): Promise<{ id: number }> {
  return call('/lessons/availability', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteAvailability(id: number): Promise<{ ok: true }> {
  return call(`/lessons/availability/${id}`, { method: 'DELETE' });
}

export async function listBookings(params: {
  from?: string;
  to?: string;
  instructor_id?: number;
  vehicle_id?: number;
  student_id?: number;
  include_cancelled?: boolean;
}): Promise<Booking[]> {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.instructor_id) searchParams.set('instructor_id', String(params.instructor_id));
  if (params.vehicle_id) searchParams.set('vehicle_id', String(params.vehicle_id));
  if (params.student_id) searchParams.set('student_id', String(params.student_id));
  if (params.include_cancelled) searchParams.set('include_cancelled', '1');
  return call(`/lessons/bookings?${searchParams.toString()}`);
}

export async function createBooking(data: BookingInput): Promise<{ id: number; warnings: string[] }> {
  return call('/lessons/bookings', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateBooking(id: number, data: BookingInput): Promise<{ ok: true; warnings: string[] }> {
  return call(`/lessons/bookings/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function cancelBooking(id: number, reason?: string): Promise<{ ok: true }> {
  return call(`/lessons/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function updateBookingStatus(
  id: number,
  status: BookingStatus,
  log_instructor_session?: boolean
): Promise<{ ok: true; instructor_session_id?: number }> {
  return call(`/lessons/bookings/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, log_instructor_session }),
  });
}

export async function getReminderConfig(): Promise<ReminderConfig> {
  return call('/lessons/reminders/config');
}

export async function runReminders(dry_run: boolean = true): Promise<{
  dry_run: boolean;
  candidates: Array<{
    booking_id: number;
    student_name: string;
    phone_masked: string;
    lesson_date: string;
    start_time: string;
  }>;
  sent: number;
  failed: number;
  skipped: number;
}> {
  return call('/lessons/reminders/run', { method: 'POST', body: JSON.stringify({ dry_run }) });
}
