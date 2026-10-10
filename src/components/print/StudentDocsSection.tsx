import React, { useEffect, useMemo, useState } from 'react';
import * as api from '../../api/client';
import { Course, Enrollment, Payment, ReceiptSettings, Student } from '../../types';
import { jalaliToday } from '../../utils/normalize';
import RegistrationDocsPanel, { DocsInput } from './RegistrationDocsPanel';

let settingsCache: Promise<ReceiptSettings | null> | null = null;
const loadSettings = () => (settingsCache ??= api.fetchReceiptSettings().catch(() => { settingsCache = null; return null; }));

/** "مدارک ثبت‌نام" block of the student profile card: the three documents of one enrollment (course) of the student. */
export default function StudentDocsSection({
  student, enrollments, courses, payments, onRefresh, preferredEnrollmentId,
}: {
  student: Student;
  enrollments: Enrollment[];
  courses: Course[];
  payments: Payment[];
  onRefresh?: () => void;
  preferredEnrollmentId?: number | null;
}) {
  const mine = useMemo(() => enrollments.filter((e) => e.student_id === student.id).sort((a, b) => b.id - a.id), [enrollments, student.id]);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  useEffect(() => { let on = true; void loadSettings().then((s) => { if (on) setSettings(s); }); return () => { on = false; }; }, []);
  useEffect(() => { setPickedId(null); }, [student.id]);

  const enrollment = mine.find((e) => e.id === pickedId) ?? mine.find((e) => e.id === preferredEnrollmentId) ?? mine[0];
  const course = enrollment ? courses.find((c) => c.id === enrollment.course_id) : undefined;
  const paid = enrollment ? payments.filter((p) => p.enrollment_id === enrollment.id).reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0;

  const input = useMemo<DocsInput | null>(() => enrollment ? {
    student,
    enrollment: { id: enrollment.id, course_number: enrollment.course_number ?? null, final_price: enrollment.final_price },
    course: course ?? null,
    paid,
    settings,
    images: { personal: student.personal_photo_url, nationalCard: student.id_card_photo_url },
    date: enrollment.signup_date_jalali || jalaliToday(),
  } : null, [student, enrollment, course, paid, settings]);

  if (!enrollment || !input) {
    return <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">این کارآموز ثبت‌نام دوره‌ای ندارد؛ مدارک ثبت‌نام ساخته نمی‌شود.</div>;
  }
  return (
    <div className="space-y-2" id="student-registration-docs">
      {mine.length > 1 && (
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          مدارک کدام ثبت‌نام؟
          <select value={enrollment.id} onChange={(e) => setPickedId(Number(e.target.value))}
            className="px-2 py-1 border border-slate-200 rounded-lg bg-white text-[11px]">
            {mine.map((e) => {
              const c = courses.find((x) => x.id === e.course_id);
              return <option key={e.id} value={e.id}>{`رسید ${e.id} — دوره ${e.course_number ?? '—'} — ${c?.title ?? 'دوره نامشخص'}`}</option>;
            })}
          </select>
        </label>
      )}
      {/* Remount per enrollment/settings so the stored paths and texts are those of the picked enrollment. */}
      <React.Fragment key={`${student.id}-${enrollment.id}-${settings ? 's' : 'n'}`}>
        <RegistrationDocsPanel
          input={input}
          existing={{ Receipt: enrollment.receipt_pdf_path, IDCard: enrollment.idcard_pdf_path, Contract: enrollment.contract_pdf_path }}
          onPathsChange={() => onRefresh?.()}
        />
      </React.Fragment>
    </div>
  );
}
