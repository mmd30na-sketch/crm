import assert from 'node:assert/strict';
import {
  parseTime,
  overlaps,
  findConflicts,
  withinAvailability,
  jalaliWeekday,
  lessonStartUtc,
  weekStart,
  durationHours,
} from '../lessonCore.ts';

// ---------- overlaps ----------
assert.strictEqual(overlaps('10:00', '11:00', '11:00', '12:00'), false, 'touching end/start should not overlap');
assert.strictEqual(overlaps('10:00', '11:01', '11:00', '12:00'), true, 'overlap by 1 minute');

// ---------- findConflicts ----------
const candidate = {
  id: 999,
  instructor_id: 1,
  vehicle_id: 5,
  student_id: 10,
  lesson_date: '1405/08/10',
  start_time: '10:00',
  end_time: '11:00',
  status: 'scheduled',
};

const existing = [
  // same instructor, overlapping
  {
    id: 1,
    instructor_id: 1,
    vehicle_id: 2,
    student_id: 20,
    lesson_date: '1405/08/10',
    start_time: '10:30',
    end_time: '11:30',
    status: 'scheduled',
  },
  // different instructor, same vehicle, overlapping
  {
    id: 2,
    instructor_id: 2,
    vehicle_id: 5,
    student_id: 30,
    lesson_date: '1405/08/10',
    start_time: '09:00',
    end_time: '10:30',
    status: 'scheduled',
  },
  // same student, non‑overlapping
  {
    id: 3,
    instructor_id: 3,
    vehicle_id: 6,
    student_id: 10,
    lesson_date: '1405/08/10',
    start_time: '12:00',
    end_time: '13:00',
    status: 'scheduled',
  },
  // cancelled status should be ignored
  {
    id: 4,
    instructor_id: 1,
    vehicle_id: 5,
    student_id: 10,
    lesson_date: '1405/08/10',
    start_time: '10:15',
    end_time: '10:45',
    status: 'cancelled',
  },
  // different date ignored
  {
    id: 5,
    instructor_id: 1,
    vehicle_id: 5,
    student_id: 10,
    lesson_date: '1405/08/11',
    start_time: '10:15',
    end_time: '10:45',
    status: 'scheduled',
  },
];

const conflicts = findConflicts(candidate, existing);
assert.strictEqual(conflicts.length, 2, 'expected instructor + vehicle conflicts');
assert.deepStrictEqual(
  conflicts.map((c) => c.kind).sort(),
  ['instructor', 'vehicle'].sort(),
  'conflict kinds mismatch',
);

// ---------- withinAvailability ----------
const rows = [
  {
    instructor_id: 1,
    weekday: 2, // Monday
    start_time: '09:00',
    end_time: '12:00',
  },
  {
    instructor_id: 1,
    weekday: 2,
    start_time: '14:00',
    end_time: '17:00',
  },
];
const candidateInWindow = {
  ...candidate,
  instructor_id: 1,
  lesson_date: '1405/08/04', // 1405/08/04 is Monday (weekday 2)
  start_time: '09:30',
  end_time: '10:30',
};
assert.strictEqual(withinAvailability(candidateInWindow, rows), true, 'should be within availability');

const candidateOutside = {
  ...candidate,
  instructor_id: 1,
  lesson_date: '1405/08/04',
  start_time: '12:30',
  end_time: '13:30',
};
assert.strictEqual(withinAvailability(candidateOutside, rows), false, 'should be outside availability');

// ---------- parseTime with Persian digits ----------
assert.strictEqual(parseTime('۰۸:۰۵'), '08:05', 'Persian digits parsed');
assert.strictEqual(parseTime('8:5'), '08:05', 'single digit parts padded');

// ---------- jalaliWeekday ----------
assert.strictEqual(jalaliWeekday('1405/08/03'), 1, '1405/08/03 should be weekday 1 (Sunday)');

// ---------- lessonStartUtc ----------
const utc = lessonStartUtc('1405/08/07', '10:00');
assert.ok(utc instanceof Date, 'lessonStartUtc returns Date');
assert.strictEqual(utc?.toISOString(), '2026-10-29T06:30:00.000Z', 'UTC conversion correct');

// ---------- weekStart ----------
assert.strictEqual(weekStart('1405/08/07'), '1405/08/02', 'Week start (Saturday) correct');

console.log('lesson core tests passed');

// ---------- integration review additions ----------
{
  const base = { instructor_id: 1, vehicle_id: 5, student_id: 9, lesson_date: '1405/08/07', start_time: '10:00', end_time: '11:00', status: 'scheduled' };
  // different instructor, different vehicle, different student: no conflict
  assert.deepStrictEqual(findConflicts(base, [{ ...base, id: 2, instructor_id: 2, vehicle_id: 6, student_id: 10 }]), []);
  // only the vehicle is shared
  assert.deepStrictEqual(findConflicts(base, [{ ...base, id: 3, instructor_id: 2, student_id: 10 }]).map((c) => c.kind), ['vehicle']);
  // availability rows of another instructor do not restrict this one
  assert.strictEqual(withinAvailability(base, [{ instructor_id: 2, weekday: 5, start_time: '08:00', end_time: '09:00' }]), true);
  // 1405/08/07 is a Thursday -> weekday 5
  assert.strictEqual(withinAvailability(base, [{ instructor_id: 1, weekday: 5, start_time: '08:00', end_time: '12:00' }]), true);
  assert.strictEqual(withinAvailability(base, [{ instructor_id: 1, weekday: 4, start_time: '08:00', end_time: '12:00' }]), false);
  assert.strictEqual(durationHours('10:00', '11:30'), 1.5);
  console.log('lesson review tests passed');
}
