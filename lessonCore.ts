/**
 * Core helper functions for lesson scheduling.
 * Pure functions, no side‑effects.
 */
import {
  jalaliToGregorian,
  jalaliToJdn,
  jdnToJalali,
  addJalaliDays,
} from './src/utils/jalali';

export type BookingStatus = 'scheduled' | 'done' | 'cancelled' | 'no_show';

export const BOOKING_STATUSES: readonly BookingStatus[] = ['scheduled', 'done', 'cancelled', 'no_show'];

export const ACTIVE_STATUSES: readonly BookingStatus[] = ['scheduled', 'done'];

/**
 * Parse a time string, allowing Persian digits.
 * Returns a normalized "HH:MM" string or null.
 */
export function parseTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // replace Persian digits with Latin ones
  const persianDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const latinDigits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  let s = v.trim();
  persianDigits.forEach((re, i) => {
    s = s.replace(re, latinDigits[i]);
  });
  // allow "8:5" or "08:05"
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const hh = hour.toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Convert "HH:MM" to total minutes.
 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert minutes to "HH:MM".
 */
export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

/**
 * Normalize a Jalali date string.
 * Accepts Persian digits and "-" separator, pads components, validates.
 */
export function normalizeJalali(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // replace Persian digits
  const persianDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const latinDigits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  let s = v.trim();
  persianDigits.forEach((re, i) => {
    s = s.replace(re, latinDigits[i]);
  });
  s = s.replace(/-/g, '/');
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => p.padStart(p.length < 2 ? 2 : p.length, '0'));
  const year = y.padStart(4, '0');
  const month = m.padStart(2, '0');
  const day = d.padStart(2, '0');
  const normalized = `${year}/${month}/${day}`;
  return jalaliToJdn(normalized) !== null ? normalized : null;
}

/**
 * Return weekday number for a Jalali date (0 = Saturday … 6 = Friday).
 */
export function jalaliWeekday(date: string): number | null {
  const jdn = jalaliToJdn(date);
  if (jdn === null) return null;
  const g = jalaliToGregorian(date);
  if (!g) return null;
  const utcDay = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay(); // 0=Sun … 6=Sat
  // map to 0=Sat … 6=Fri
  return (utcDay + 1) % 7;
}

/**
 * Determine whether two half‑open time intervals overlap.
 */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const aS = timeToMinutes(aStart);
  const aE = timeToMinutes(aEnd);
  const bS = timeToMinutes(bStart);
  const bE = timeToMinutes(bEnd);
  return aS < bE && bS < aE;
}

/** Booking shape used by conflict detection */
export type BookingLike = {
  id?: number;
  instructor_id: number;
  vehicle_id?: number | null;
  student_id?: number;
  lesson_date: string;
  start_time: string;
  end_time: string;
  status: string;
};

export type Conflict = {
  kind: 'instructor' | 'vehicle' | 'student';
  booking_id: number;
  lesson_date: string;
  start_time: string;
  end_time: string;
};

/**
 * Find conflicts for a candidate booking against existing ones.
 */
export function findConflicts(
  candidate: BookingLike,
  existing: BookingLike[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const e of existing) {
    if (
      candidate.id !== undefined &&
      e.id !== undefined &&
      Number(candidate.id) === Number(e.id)
    ) {
      continue; // same booking
    }
    if (!ACTIVE_STATUSES.includes(e.status as BookingStatus)) continue;
    if (candidate.lesson_date !== e.lesson_date) continue;
    if (
      !overlaps(
        candidate.start_time,
        candidate.end_time,
        e.start_time,
        e.end_time,
      )
    ) {
      continue;
    }
    const base = {
      booking_id: e.id!,
      lesson_date: e.lesson_date,
      start_time: e.start_time,
      end_time: e.end_time,
    };
    if (Number(candidate.instructor_id) === Number(e.instructor_id)) {
      conflicts.push({ kind: 'instructor', ...base });
    }
    // vehicle conflict if both have non‑null vehicle_id and equal
    if (
      candidate.vehicle_id != null &&
      e.vehicle_id != null &&
      Number(candidate.vehicle_id) === Number(e.vehicle_id)
    ) {
      conflicts.push({ kind: 'vehicle', ...base });
    }
    // student conflict if both have student_id and equal
    if (
      candidate.student_id != null &&
      e.student_id != null &&
      Number(candidate.student_id) === Number(e.student_id)
    ) {
      conflicts.push({ kind: 'student', ...base });
    }
  }
  return conflicts;
}

/** Availability row */
export type AvailabilityRow = {
  instructor_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
};

/**
 * Check if a candidate booking fits inside at least one availability row.
 * If the instructor has no rows at all, the function returns true (unrestricted).
 */
export function withinAvailability(
  candidate: BookingLike,
  rows: AvailabilityRow[],
): boolean {
  const mine = rows.filter((r) => Number(r.instructor_id) === Number(candidate.instructor_id));
  // No rows for this instructor = unrestricted
  if (mine.length === 0) return true;
  const wk = jalaliWeekday(candidate.lesson_date);
  if (wk === null) return false;
  const relevant = mine.filter((r) => Number(r.weekday) === wk);
  if (relevant.length === 0) return false;
  const cStart = timeToMinutes(candidate.start_time);
  const cEnd = timeToMinutes(candidate.end_time);
  return relevant.some((r) => {
    const rStart = timeToMinutes(r.start_time);
    const rEnd = timeToMinutes(r.end_time);
    return rStart <= cStart && rEnd >= cEnd;
  });
}

/**
 * Convert a Jalali date + local time (Asia/Tehran, UTC+03:30) to a UTC Date.
 */
export function lessonStartUtc(date: string, time: string): Date | null {
  const g = jalaliToGregorian(date);
  if (!g) return null;
  const parsedTime = parseTime(time);
  if (!parsedTime) return null;
  const [hh, mm] = parsedTime.split(':').map(Number);
  const utcMillis =
    Date.UTC(g.gy, g.gm - 1, g.gd, hh, mm) - 3.5 * 60 * 60 * 1000;
  return new Date(utcMillis);
}

/**
 * Duration in hours, rounded to one decimal place.
 */
export function durationHours(start: string, end: string): number {
  const mins = timeToMinutes(end) - timeToMinutes(start);
  const hrs = mins / 60;
  return Math.round(hrs * 10) / 10;
}

/**
 * Return the Jalali date of the Saturday that starts the week containing `date`.
 */
export function weekStart(date: string): string {
  const jdn = jalaliToJdn(date);
  if (jdn === null) throw new Error('Invalid Jalali date');
  const wk = jalaliWeekday(date);
  if (wk === null) throw new Error('Invalid weekday');
  const satJdn = jdn - wk; // subtract offset to Saturday
  return jdnToJalali(satJdn);
}

/**
 * Return an array of the seven Jalali dates of the week (Saturday … Friday).
 */
export function weekDates(date: string): string[] {
  const start = weekStart(date);
  const res: string[] = [];
  for (let i = 0; i < 7; i++) {
    res.push(addJalaliDays(start, i));
  }
  return res;
}
