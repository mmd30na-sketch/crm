import React, { useState, useMemo } from 'react';
import {
  Search,
  Edit3,
  Printer,
  MessageSquare,
  Trash2,
  ZoomIn,
  CreditCard,
  Phone,
  MapPin,
  Calendar,
  AlertCircle,
  CheckCircle,
  X,
  User,
  FileText,
  Send,
  Building,
  Filter,
  UserCheck,
  ChevronDown,
  DollarSign,
  SlidersHorizontal,
} from 'lucide-react';
import { Student, Course, Enrollment, Payment } from '../types';
import * as api from '../api/client';

interface StudentsListProps {
  students?: Student[];
  courses?: Course[];
  enrollments?: Enrollment[];
  payments?: Payment[];
  onRefresh?: () => void;
  onActiveTabChange?: (tab: string, enrollmentIdOrStudentId?: number) => void;
}

const INITIAL_MOCK_STUDENTS: Student[] = [
  { id: 1, first_name: 'امیرحسین', last_name: 'رضایی', father_name: 'علیرضا', national_code: '0012345678', phone_number: '09123456789', birth_date_jalali: '1378/04/15', address: 'تهران، محله ونک، خیابان ملاصدرا، کوچه شیراز، پلاک ۱۲', personal_photo_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400', id_card_photo_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600', status: 'active', created_at: '2026-06-20T10:00:00Z' },
  { id: 2, first_name: 'سارا', last_name: 'احمدی', father_name: 'حمید', national_code: '0459876543', phone_number: '09198765432', birth_date_jalali: '1382/10/22', address: 'تهران، شهرک غرب، بلوار پاکنژاد، کوچه مریم، پلاک ۵', personal_photo_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400', id_card_photo_url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&q=80&w=600', status: 'active', created_at: '2026-07-01T10:00:00Z' },
  { id: 3, first_name: 'محمدرضا', last_name: 'کریمی', father_name: 'محمد', national_code: '2991234567', phone_number: '09355551122', birth_date_jalali: '1375/01/01', address: 'تهران، تهرانپارس، خیابان رشید، نبش ۱۵۴، پلاک ۸', personal_photo_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400', id_card_photo_url: 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?auto=format&fit=crop&q=80&w=600', status: 'suspended', created_at: '2026-06-05T10:00:00Z' },
  { id: 4, first_name: 'نیلوفر', last_name: 'صادقی', father_name: 'بهرام', national_code: '0087654321', phone_number: '09129876543', birth_date_jalali: '1380/06/12', address: 'تهران، سعادت‌آباد، صراف‌های شمالی، کوچه یازدهم، پلاک ۴۲', personal_photo_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=400', id_card_photo_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600', status: 'active', created_at: '2026-05-15T10:00:00Z' },
  { id: 5, first_name: 'کیوان', last_name: 'حسینی', father_name: 'رضا', national_code: '1270984512', phone_number: '09361112233', birth_date_jalali: '1377/11/30', address: 'تهران، پاسداران، بوستان پنجم، پلاک ۱۸، واحد ۴', personal_photo_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400', id_card_photo_url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&q=80&w=600', status: 'active', created_at: '2026-07-10T10:00:00Z' },
];

const INITIAL_MOCK_COURSES: Course[] = [
  { id: 1, title: 'گواهینامه پایه سوم (سواری)', code: 'C3-DRIVE', tuition: 4500000, duration_weeks: 10, active: true },
  { id: 2, title: 'موتور سیکلت (پایه الف)', code: 'MOTO-A', tuition: 2200000, duration_weeks: 6, active: true },
  { id: 3, title: 'گواهینامه پایه دوم (سنگین)', code: 'C2-HEAVY', tuition: 6800000, duration_weeks: 12, active: true },
  { id: 4, title: 'گواهینامه پایه یک (ترانزیت)', code: 'C1-TRAILER', tuition: 9500000, duration_weeks: 16, active: true },
];

const INITIAL_MOCK_ENROLLMENTS: Enrollment[] = [
  { id: 1, student_id: 1, course_id: 1, course_number: 104, signup_date_jalali: '۱۴۰۵/۰۴/۲۰', final_price: 4500000 },
  { id: 2, student_id: 2, course_id: 2, course_number: 88,  signup_date_jalali: '۱۴۰۵/۰۵/۰۵', final_price: 2200000 },
  { id: 3, student_id: 3, course_id: 3, course_number: 32,  signup_date_jalali: '۱۴۰۵/۰۴/۰۱', final_price: 6800000 },
  { id: 4, student_id: 4, course_id: 4, course_number: 15,  signup_date_jalali: '۱۴۰۵/۰۳/۱۵', final_price: 9500000 },
  { id: 5, student_id: 5, course_id: 1, course_number: 106, signup_date_jalali: '۱۴۰۵/۰۵/۱۰', final_price: 4500000 },
];

const INITIAL_MOCK_PAYMENTS: Payment[] = [
  { id: 1, student_id: 1, enrollment_id: 1, amount: 2500000, pay_date_jalali: '۱۴۰۵/۰۴/۲۰', pay_method: 'pos',           payment_kind: 'downpayment', description: 'پیش‌پرداخت اولیه' },
  { id: 2, student_id: 1, enrollment_id: 1, amount: 2000000, pay_date_jalali: '۱۴۰۵/۰۵/۱۰', pay_method: 'card_transfer', payment_kind: 'full',        description: 'تسویه حساب نهایی' },
  { id: 3, student_id: 2, enrollment_id: 2, amount: 1200000, pay_date_jalali: '۱۴۰۵/۰۵/۰۵', pay_method: 'cash',           payment_kind: 'downpayment', description: 'نقدی به صندوق' },
  { id: 4, student_id: 3, enrollment_id: 3, amount: 3000000, pay_date_jalali: '۱۴۰۵/۰۴/۰۱', pay_method: 'pos',           payment_kind: 'downpayment', description: 'قسط اول' },
  { id: 5, student_id: 4, enrollment_id: 4, amount: 9500000, pay_date_jalali: '۱۴۰۵/۰۳/۱۵', pay_method: 'pos',           payment_kind: 'full',        description: 'پرداخت یکجا' },
  { id: 6, student_id: 5, enrollment_id: 5, amount: 2000000, pay_date_jalali: '۱۴۰۵/۰۵/۱۰', pay_method: 'pos',           payment_kind: 'downpayment', description: 'پیش‌پرداخت' },
];

/* ────────────────────────────────────────────
   SUB-COMPONENTS
──────────────────────────────────────────── */

function InfoCell({ icon: Icon, label, value, mono = false, accent = 'sky' }: {
  icon: React.ElementType; label: string; value: string;
  mono?: boolean; accent?: 'sky' | 'teal' | 'rose' | 'violet' | 'amber';
}) {
  const accentMap: Record<string, string> = {
    sky: 'text-sky-500', teal: 'text-teal-500', rose: 'text-rose-500',
    violet: 'text-violet-500', amber: 'text-amber-500',
  };
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 hover:border-sky-200 hover:bg-sky-50/40 transition-all duration-200">
      <div className={`flex items-center gap-1.5 mb-1 ${accentMap[accent]}`}>
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-slate-800 font-semibold text-sm truncate ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: Student['status'] }) {
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />فعال
    </span>
  );
  if (status === 'suspended') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-bold">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />تعلیق
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-bold">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />فارغ‌التحصیل
    </span>
  );
}

/* ────────────────────────────────────────────
   MAIN COMPONENT
──────────────────────────────────────────── */

export default function StudentsList({
  students: propStudents,
  courses: propCourses,
  enrollments: propEnrollments,
  payments: propPayments,
  onRefresh,
  onActiveTabChange,
}: StudentsListProps) {

  const [localStudents, setLocalStudents]     = useState<Student[]>(INITIAL_MOCK_STUDENTS);
  const [localCourses]                         = useState<Course[]>(INITIAL_MOCK_COURSES);
  const [localEnrollments, setLocalEnrollments]= useState<Enrollment[]>(INITIAL_MOCK_ENROLLMENTS);
  const [localPayments, setLocalPayments]      = useState<Payment[]>(INITIAL_MOCK_PAYMENTS);

  const studentsList    = propStudents    && propStudents.length    > 0 ? propStudents    : localStudents;
  const coursesList     = propCourses     && propCourses.length     > 0 ? propCourses     : localCourses;
  const enrollmentsList = propEnrollments && propEnrollments.length > 0 ? propEnrollments : localEnrollments;
  const paymentsList    = propPayments    && propPayments.length    > 0 ? propPayments    : localPayments;

  const [selectedStudentId, setSelectedStudentId] = useState<number>(() => studentsList[0]?.id ?? 1);

  const [searchTerm,          setSearchTerm]          = useState('');
  const [courseFilter,        setCourseFilter]        = useState('all');
  const [courseNumberFilter,  setCourseNumberFilter]  = useState('all');
  const [financialFilter,     setFinancialFilter]     = useState<'all' | 'settled' | 'debtors'>('all');

  const [zoomPhotoUrl,          setZoomPhotoUrl]          = useState<{ url: string; title: string } | null>(null);
  const [editingStudent,        setEditingStudent]        = useState<Student | null>(null);
  const [isPrintModalOpen,      setIsPrintModalOpen]      = useState(false);
  const [messagingStudent,      setMessagingStudent]      = useState<Student | null>(null);
  const [messageText,           setMessageText]           = useState('');
  const [messageSent,           setMessageSent]           = useState(false);
  const [deleteConfirmStudent,  setDeleteConfirmStudent]  = useState<Student | null>(null);
  const [paymentStudent,        setPaymentStudent]        = useState<Student | null>(null);
  const [paymentAmount,         setPaymentAmount]         = useState('');
  const [paymentMethod,         setPaymentMethod]         = useState('pos');
  const [paymentDesc,           setPaymentDesc]           = useState('واریز قسط شهریه');
  const [isSubmittingPay,       setIsSubmittingPay]       = useState(false);

  /* ── Finance helper ── */
  const getStudentFinance = (studentId: number) => {
    const enrs       = enrollmentsList.filter(e => e.student_id === studentId);
    const totalTuition= enrs.reduce((s, e) => s + (e.final_price || 0), 0);
    const pays       = paymentsList.filter(p => p.student_id === studentId);
    const totalPaid  = pays.reduce((s, p) => s + p.amount, 0);
    const debt       = Math.max(0, totalTuition - totalPaid);
    const courses    = enrs.map(e => {
      const c = coursesList.find(c => c.id === e.course_id);
      return { enrollmentId: e.id, courseTitle: c?.title ?? 'دوره نامشخص', signupDate: e.signup_date_jalali ?? '—', courseNumber: e.course_number, tuition: e.final_price };
    });
    const primaryCourse = courses[0] ?? { enrollmentId: 0, courseTitle: 'ثبت‌نام نشده', signupDate: '—', courseNumber: undefined, tuition: 0 };
    return { totalTuition, totalPaid, debt, isSettled: debt <= 0 && totalTuition > 0, courses, primaryCourse, paymentsCount: pays.length };
  };

  const formatToman = (n: number) => n.toLocaleString('fa-IR') + ' تومان';
  const pct = (paid: number, total: number) => total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

  /* ── Unique Course Numbers list ── */
  const availableCourseNumbers = useMemo(() => {
    const nums = enrollmentsList.map(e => e.course_number).filter((n): n is number => n != null);
    return Array.from(new Set(nums)).sort((a, b) => Number(b) - Number(a));
  }, [enrollmentsList]);

  /* ── Filtered list ── */
  const filteredStudents = useMemo(() => studentsList.filter(s => {
    const nm = `${s.first_name} ${s.last_name}`.toLowerCase();
    if (!nm.includes(searchTerm.toLowerCase()) && !s.national_code.includes(searchTerm) && !s.phone_number.includes(searchTerm)) return false;
    const fin = getStudentFinance(s.id);
    if (courseFilter !== 'all' && !fin.courses.some(c => c.courseTitle === courseFilter)) return false;
    if (courseNumberFilter !== 'all' && !fin.courses.some(c => String(c.courseNumber) === courseNumberFilter)) return false;
    if (financialFilter === 'settled' && !fin.isSettled) return false;
    if (financialFilter === 'debtors' && (fin.debt <= 0 || fin.totalTuition === 0)) return false;
    return true;
  }), [studentsList, enrollmentsList, paymentsList, coursesList, searchTerm, courseFilter, courseNumberFilter, financialFilter]);

  const selectedStudent = useMemo(() => studentsList.find(s => s.id === selectedStudentId) ?? filteredStudents[0] ?? null, [studentsList, selectedStudentId, filteredStudents]);
  const selectedFinance = selectedStudent ? getStudentFinance(selectedStudent.id) : null;
  const hasActiveFilters = searchTerm || courseFilter !== 'all' || financialFilter !== 'all';

  /* ── Handlers ── */
  const handleSaveStudentEdit = async () => {
    if (!editingStudent) return;
    setLocalStudents(prev => prev.map(s => s.id === editingStudent.id ? { ...editingStudent } : s));
    setEditingStudent(null);
    onRefresh?.();
  };

  const handleDeleteStudent = async (id: number) => {
    try {
      if (onRefresh) { await api.deleteStudentCascade(id); onRefresh(); }
      else {
        setLocalStudents(prev => prev.filter(s => s.id !== id));
        setLocalEnrollments(prev => prev.filter(e => e.student_id !== id));
        setLocalPayments(prev => prev.filter(p => p.student_id !== id));
      }
      setDeleteConfirmStudent(null);
      if (selectedStudentId === id) setSelectedStudentId(studentsList.find(s => s.id !== id)?.id ?? 1);
    } catch { /* noop */ }
  };

  const handleSavePayment = async () => {
    if (!paymentStudent || !paymentAmount) return;
    setIsSubmittingPay(true);
    try {
      const amount = parseFloat(paymentAmount);
      if (onRefresh) { await api.createPayment({ student_id: paymentStudent.id, amount, pay_method: paymentMethod, description: paymentDesc }); onRefresh(); }
      else { setLocalPayments(prev => [...prev, { id: Date.now(), student_id: paymentStudent.id, enrollment_id: getStudentFinance(paymentStudent.id).primaryCourse.enrollmentId || null, amount, pay_date_jalali: '۱۴۰۵/۰۵/۲۸', pay_method: paymentMethod, payment_kind: 'installment', description: paymentDesc }]); }
      setPaymentStudent(null); setPaymentAmount('');
    } finally { setIsSubmittingPay(false); }
  };

  const handleOpenMessaging = (student: Student) => {
    const fin = getStudentFinance(student.id);
    setMessagingStudent(student);
    setMessageText(fin.debt > 0
      ? `هنرجوی گرامی ${student.first_name} ${student.last_name}؛ با سلام، خواهشمند است نسبت به تسویه مانده بدهی شهریه خود به مبلغ ${formatToman(fin.debt)} اقدام فرمایید.\nآموزشگاه رانندگی کارلا`
      : `هنرجوی گرامی ${student.first_name} ${student.last_name}؛ پرونده آموزشی و مالی شما با موفقیت تسویه گردید.\nآموزشگاه رانندگی کارلا`);
    setMessageSent(false);
  };

  const handleSendMessage = () => {
    if (onActiveTabChange) { onActiveTabChange('messenger', messagingStudent?.id); }
    else { setMessageSent(true); setTimeout(() => { setMessagingStudent(null); setMessageSent(false); }, 1800); }
  };

  /* ════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════ */
  return (
    <div className="space-y-5 fade-in" id="students-list-view">

      {/* ══════════════════════════════════════════════
          SECTION 1 — PROFILE MASTER CARD
      ══════════════════════════════════════════════ */}
      {selectedStudent && selectedFinance && (
        <div
          key={selectedStudent.id}
          className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
          id="student-profile-master-card"
          style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
        >
          {/* ─── Card Top Bar ─── */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-l from-sky-50/60 to-white">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-sky-500" />
              <span className="text-sm font-bold text-slate-700">پرونده فعال</span>
              <span className="text-xs text-slate-400">/ کارآموز انتخاب‌شده</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={selectedStudent.status} />
              <span className="font-mono text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                #{String(selectedStudent.id).padStart(4, '0')}
              </span>
            </div>
          </div>

          <div className="p-6">
            {/* ─── Row 1: Photo + Info + ID Card ─── */}
            <div className="flex flex-col md:flex-row gap-5 mb-5">

              {/* Portrait Photo */}
              <div className="shrink-0 relative group">
                <div className="w-20 h-28 rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-100 shadow-sm">
                  {selectedStudent.personal_photo_url ? (
                    <img src={selectedStudent.personal_photo_url} alt="عکس پرسنلی" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                      <User className="w-8 h-8 mb-1" /><span className="text-[10px]">عکس ۳×۴</span>
                    </div>
                  )}
                  {selectedStudent.personal_photo_url && (
                    <button onClick={() => setZoomPhotoUrl({ url: selectedStudent.personal_photo_url!, title: 'عکس پرسنلی' })}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center rounded-xl">
                      <ZoomIn className="w-5 h-5 text-white" />
                    </button>
                  )}
                </div>
                <div className="absolute -bottom-1.5 -left-1.5 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                  <CheckCircle className="w-3 h-3 text-white" />
                </div>
              </div>

              {/* Name + Info Grid */}
              <div className="flex-1 min-w-0">
                <div className="mb-3">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">
                    {selectedStudent.first_name} {selectedStudent.last_name}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">فرزند {selectedStudent.father_name || '—'}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <InfoCell icon={FileText}  label="کد ملی"       value={selectedStudent.national_code}             mono accent="sky" />
                  <InfoCell icon={Phone}     label="شماره همراه"  value={selectedStudent.phone_number}               mono accent="teal" />
                  <InfoCell icon={Calendar}  label="تاریخ تولد"   value={selectedStudent.birth_date_jalali ?? '—'}        accent="violet" />
                  <InfoCell icon={Building}  label="دوره آموزشی"  value={selectedFinance.primaryCourse.courseTitle}       accent="amber" />
                </div>
              </div>

              {/* ID Card Photo */}
              <div className="shrink-0">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 text-center">اسکن کارت ملی</p>
                <div className="relative group w-36 h-24 rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-50 shadow-sm cursor-zoom-in"
                  onClick={() => selectedStudent.id_card_photo_url && setZoomPhotoUrl({ url: selectedStudent.id_card_photo_url, title: 'اسکن کارت ملی' })}>
                  {selectedStudent.id_card_photo_url ? (
                    <>
                      <img src={selectedStudent.id_card_photo_url} alt="کارت ملی" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                        <ZoomIn className="w-5 h-5 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                      <FileText className="w-7 h-7 mb-1" /><span className="text-[10px]">بدون اسکن</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ─── Row 2: Address + Financial KPI ─── */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
              <div className="md:col-span-2 bg-slate-50 border border-slate-100 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-rose-400 mb-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">نشانی سکونت</span>
                </div>
                <p className="text-sm text-slate-700 font-medium leading-relaxed">{selectedStudent.address || 'ثبت نشده'}</p>
              </div>

              {/* Financial KPI */}
              <div className="md:col-span-3 bg-white border border-slate-200 rounded-xl p-4" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-sky-500" />وضعیت مالی پرونده
                  </span>
                  {selectedFinance.isSettled ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">
                      <CheckCircle className="w-3.5 h-3.5" />تسویه کامل
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded-full text-xs font-bold">
                      <AlertCircle className="w-3.5 h-3.5" />بدهکار: {formatToman(selectedFinance.debt)}
                    </span>
                  )}
                </div>

                {/* Progress Bar */}
                <div className="carla-progress mb-3">
                  <div className="carla-progress-fill" style={{ width: `${pct(selectedFinance.totalPaid, selectedFinance.totalTuition)}%` }} />
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: 'شهریه کل', val: formatToman(selectedFinance.totalTuition), color: 'text-slate-700' },
                    { label: 'پرداخت‌شده', val: formatToman(selectedFinance.totalPaid), color: 'text-emerald-600' },
                    { label: 'مانده', val: formatToman(selectedFinance.debt), color: selectedFinance.debt > 0 ? 'text-rose-600' : 'text-emerald-600' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-2">
                      <div className="text-[10px] text-slate-400 font-medium mb-0.5">{label}</div>
                      <div className={`text-xs font-mono font-bold ${color}`}>{val}</div>
                    </div>
                  ))}
                </div>

                {selectedFinance.debt > 0 && (
                  <button onClick={() => { setPaymentStudent(selectedStudent); setPaymentAmount(selectedFinance.debt.toString()); }}
                    className="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer">
                    <CreditCard className="w-3.5 h-3.5" />ثبت پرداختی
                  </button>
                )}
              </div>
            </div>

            {/* ─── Row 3: Action Buttons ─── */}
            <div className="flex items-center flex-wrap justify-end gap-2 pt-4 border-t border-slate-100">
              <button onClick={() => setEditingStudent({ ...selectedStudent })}
                className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition cursor-pointer shadow-sm">
                <Edit3 className="w-3.5 h-3.5" />ویرایش پرونده
              </button>
              <button onClick={() => setIsPrintModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition cursor-pointer shadow-sm">
                <Printer className="w-3.5 h-3.5" />چاپ رسید
              </button>
              <button onClick={() => handleOpenMessaging(selectedStudent)}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg transition cursor-pointer shadow-sm">
                <MessageSquare className="w-3.5 h-3.5" />ارسال پیام
              </button>
              <button onClick={() => setDeleteConfirmStudent(selectedStudent)}
                className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-400 text-xs font-bold rounded-lg transition cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" />حذف پرونده
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          SECTION 2 — TABLE WITH SEARCH & FILTERS
      ══════════════════════════════════════════════ */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm" id="students-datasheet-section"
        style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>

        {/* ─── Toolbar ─── */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">

            {/* Left: Title */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-bold text-slate-700">لیست کارآموزان</span>
              <span className="text-xs font-bold text-sky-600 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full font-mono">
                {filteredStudents.length} نفر
              </span>
            </div>

            {/* Right: Search + Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="جستجو نام، کد ملی، شماره..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-52 pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
                />
              </div>

              {/* Course Filter */}
              <div className="relative">
                <Filter className="w-3 h-3 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={courseFilter}
                  onChange={e => setCourseFilter(e.target.value)}
                  className="pr-7 pl-7 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-sky-400 cursor-pointer appearance-none transition"
                >
                  <option value="all">همه دوره‌ها</option>
                  {coursesList.map(c => <option key={c.id} value={c.title}>{c.title}</option>)}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* Course Number Filter (تفکیک بر اساس شماره دوره) */}
              <div className="relative">
                <SlidersHorizontal className="w-3 h-3 text-amber-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={courseNumberFilter}
                  onChange={e => setCourseNumberFilter(e.target.value)}
                  className="pr-7 pl-7 py-2 text-xs border border-amber-200 bg-amber-50/50 font-bold text-amber-900 rounded-xl focus:outline-none focus:border-amber-400 cursor-pointer appearance-none transition"
                >
                  <option value="all">شماره دوره (همه کلاس‌ها)</option>
                  {availableCourseNumbers.map(n => <option key={n} value={String(n)}>دوره شماره {n}</option>)}
                </select>
                <ChevronDown className="w-3 h-3 text-amber-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* Financial Filter */}
              <div className="relative">
                <select
                  value={financialFilter}
                  onChange={e => setFinancialFilter(e.target.value as any)}
                  className="pr-3 pl-7 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-sky-400 cursor-pointer appearance-none transition"
                >
                  <option value="all">وضعیت مالی (همه)</option>
                  <option value="settled">تسویه‌شده</option>
                  <option value="debtors">بدهکاران</option>
                </select>
                <ChevronDown className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <button onClick={() => { setSearchTerm(''); setCourseFilter('all'); setFinancialFilter('all'); }}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 transition cursor-pointer">
                  <X className="w-3 h-3" />پاک‌سازی
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ─── Table ─── */}
        {filteredStudents.length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
            <AlertCircle className="w-10 h-10" />
            <p className="text-sm font-semibold">هیچ کارآموزی یافت نشد</p>
            <p className="text-xs">فیلترها یا عبارت جستجو را تغییر دهید</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  {['کارآموز', 'کد ملی', 'شماره همراه', 'دوره آموزشی', 'کلاس', 'وضعیت مالی', 'وضعیت'].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredStudents.map(s => {
                  const fin       = getStudentFinance(s.id);
                  const isSelected= selectedStudent?.id === s.id;
                  const progress  = pct(fin.totalPaid, fin.totalTuition);

                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedStudentId(s.id)}
                      className={`cursor-pointer transition-all duration-150 hover:bg-sky-50/60 ${isSelected ? 'bg-sky-50 border-r-2 border-sky-500' : 'bg-white'}`}
                    >
                      {/* Avatar + Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 relative">
                            <div className="w-9 h-9 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                              {s.personal_photo_url
                                ? <img src={s.personal_photo_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                : <div className="w-full h-full flex items-center justify-center text-slate-400"><User className="w-4 h-4" /></div>
                              }
                            </div>
                            {isSelected && (
                              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-sky-500 rounded-full border-2 border-white flex items-center justify-center">
                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                              </div>
                            )}
                          </div>
                          <div>
                            <div className={`text-sm font-bold ${isSelected ? 'text-sky-700' : 'text-slate-800'}`}>
                              {s.first_name} {s.last_name}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">#{String(s.id).padStart(4, '0')}</div>
                          </div>
                        </div>
                      </td>

                      {/* National Code */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">{s.national_code}</span>
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-600 dir-ltr">{s.phone_number}</span>
                      </td>

                      {/* Course */}
                      <td className="px-4 py-3 max-w-[160px]">
                        <span className="text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-lg truncate block">
                          {fin.primaryCourse.courseTitle}
                        </span>
                      </td>

                      {/* Class # */}
                      <td className="px-4 py-3">
                        {fin.primaryCourse.courseNumber
                          ? <span className="font-mono text-xs font-bold text-violet-700 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-lg">#{fin.primaryCourse.courseNumber}</span>
                          : <span className="text-slate-300 text-xs">—</span>
                        }
                      </td>

                      {/* Financial + Mini Progress */}
                      <td className="px-4 py-3">
                        <div className="space-y-1 min-w-[110px]">
                          {fin.isSettled ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <CheckCircle className="w-3 h-3" />تسویه
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono font-bold text-rose-600">{formatToman(fin.debt)}</span>
                          )}
                          <div className="h-1 bg-slate-100 rounded-full overflow-hidden w-20">
                            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: fin.isSettled ? '#10b981' : 'linear-gradient(90deg,#0ea5e9,#2dd4bf)' }} />
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={s.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── Table Footer ─── */}
        {filteredStudents.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              نمایش <strong className="text-slate-600">{filteredStudents.length}</strong> از <strong className="text-slate-600">{studentsList.length}</strong> کارآموز
            </span>
            <span className="text-[10px] text-slate-300">برای مشاهده پرونده روی هر ردیف کلیک کنید</span>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════ */}

      {/* 1. Photo Lightbox */}
      {zoomPhotoUrl && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={() => setZoomPhotoUrl(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-2xl w-full space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ZoomIn className="w-4 h-4 text-sky-400" />{zoomPhotoUrl.title}
              </h3>
              <button onClick={() => setZoomPhotoUrl(null)} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-hidden rounded-xl bg-black flex items-center justify-center">
              <img src={zoomPhotoUrl.url} alt="" className="max-h-[68vh] w-auto object-contain" referrerPolicy="no-referrer" />
            </div>
          </div>
        </div>
      )}

      {/* 2. Edit Student Modal */}
      {editingStudent && (
        <div className="carla-modal-overlay">
          <div className="carla-modal p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center"><Edit3 className="w-4 h-4 text-sky-600" /></div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">ویرایش پرونده کارآموز</h3>
                  <p className="text-xs text-slate-400">{editingStudent.first_name} {editingStudent.last_name}</p>
                </div>
              </div>
              <button onClick={() => setEditingStudent(null)} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'نام', key: 'first_name', type: 'text' },
                  { label: 'نام خانوادگی', key: 'last_name', type: 'text' },
                  { label: 'کد ملی', key: 'national_code', type: 'text' },
                  { label: 'شماره همراه', key: 'phone_number', type: 'text' },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
                    <input type={type} value={(editingStudent as any)[key]}
                      onChange={e => setEditingStudent({ ...editingStudent, [key]: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition" />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">تاریخ تولد (شمسی)</label>
                <input type="text" value={editingStudent.birth_date_jalali || ''}
                  onChange={e => setEditingStudent({ ...editingStudent, birth_date_jalali: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">آدرس منزل</label>
                <textarea rows={2} value={editingStudent.address || ''}
                  onChange={e => setEditingStudent({ ...editingStudent, address: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition resize-none" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button onClick={() => setEditingStudent(null)} className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer">انصراف</button>
              <button onClick={handleSaveStudentEdit} className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition cursor-pointer shadow-sm">ذخیره تغییرات</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Print Receipt Modal */}
      {isPrintModalOpen && selectedStudent && selectedFinance && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-2xl w-full space-y-4 text-slate-100 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Printer className="w-4 h-4 text-teal-400" />پیش‌نمایش رسید رسمی
              </h3>
              <button onClick={() => setIsPrintModalOpen(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"><X className="w-4 h-4" /></button>
            </div>
            <div id="printable-receipt" className="bg-white text-slate-900 p-6 rounded-xl border border-slate-200 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b-2 border-slate-800 pb-4">
                <div><h2 className="text-base font-extrabold">آموزشگاه رانندگی کارلا</h2><p className="text-xs text-slate-500">رسید رسمی ثبت‌نام و وضعیت مالی</p></div>
                <div className="font-mono text-xs text-right space-y-0.5"><div>شماره: #{String(selectedStudent.id).padStart(5, '0')}</div><div>تاریخ: ۱۴۰۵/۰۵/۲۸</div></div>
              </div>
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div><strong>نام:</strong> {selectedStudent.first_name} {selectedStudent.last_name}</div>
                <div><strong>کد ملی:</strong> {selectedStudent.national_code}</div>
                <div><strong>شماره همراه:</strong> {selectedStudent.phone_number}</div>
                <div><strong>دوره:</strong> {selectedFinance.primaryCourse.courseTitle}</div>
              </div>
              <table className="w-full border-collapse border border-slate-200 text-right">
                <thead><tr className="bg-slate-100"><th className="p-2 border border-slate-200">عنوان</th><th className="p-2 border border-slate-200">مبلغ (تومان)</th></tr></thead>
                <tbody>
                  <tr><td className="p-2 border border-slate-200">شهریه مصوب دوره</td><td className="p-2 border border-slate-200 font-mono">{formatToman(selectedFinance.totalTuition)}</td></tr>
                  <tr><td className="p-2 border border-slate-200">مجموع دریافتی</td><td className="p-2 border border-slate-200 font-mono text-emerald-700 font-bold">{formatToman(selectedFinance.totalPaid)}</td></tr>
                  <tr className="bg-slate-50"><td className="p-2 border border-slate-200 font-bold">مانده بدهی</td><td className="p-2 border border-slate-200 font-mono font-bold text-rose-700">{formatToman(selectedFinance.debt)}</td></tr>
                </tbody>
              </table>
              <div className="pt-8 grid grid-cols-2 text-center text-xs text-slate-500">
                <div>مهر و امضای آموزشگاه</div><div>امضای هنرجو</div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsPrintModalOpen(false)} className="px-4 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition cursor-pointer">بستن</button>
              <button onClick={() => window.print()} className="px-5 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition flex items-center gap-1.5 cursor-pointer">
                <Printer className="w-3.5 h-3.5" />چاپ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Messaging Modal */}
      {messagingStudent && (
        <div className="carla-modal-overlay">
          <div className="carla-modal p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center"><MessageSquare className="w-4 h-4 text-violet-600" /></div>
                <div><h3 className="text-sm font-bold text-slate-900">ارسال پیام</h3><p className="text-xs text-slate-400">{messagingStudent.first_name} {messagingStudent.last_name} — {messagingStudent.phone_number}</p></div>
              </div>
              <button onClick={() => setMessagingStudent(null)} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 transition"><X className="w-4 h-4" /></button>
            </div>
            {messageSent ? (
              <div className="text-center py-8 space-y-3">
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
                <p className="text-sm font-bold text-slate-900">پیام با موفقیت ارسال شد</p>
              </div>
            ) : (
              <>
                <textarea rows={5} value={messageText} onChange={e => setMessageText(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none leading-7 transition" />
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button onClick={() => setMessagingStudent(null)} className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer">انصراف</button>
                  <button onClick={handleSendMessage} className="px-5 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition flex items-center gap-1.5 cursor-pointer">
                    <Send className="w-3.5 h-3.5" />ارسال فوری
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 5. New Payment Modal */}
      {paymentStudent && (
        <div className="carla-modal-overlay">
          <div className="carla-modal p-6 space-y-4" style={{ maxWidth: 420 }}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center"><CreditCard className="w-4 h-4 text-emerald-600" /></div>
                <div><h3 className="text-sm font-bold text-slate-900">ثبت پرداختی جدید</h3><p className="text-xs text-slate-400">{paymentStudent.first_name} {paymentStudent.last_name}</p></div>
              </div>
              <button onClick={() => setPaymentStudent(null)} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 transition"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">مبلغ واریزی (تومان)</label>
                <input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="مثال: 1000000"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl font-mono focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">روش دریافت</label>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-400 cursor-pointer transition appearance-none">
                  <option value="pos">دستگاه کارتخوان</option>
                  <option value="card_transfer">کارت به کارت</option>
                  <option value="cash">نقدی به صندوق</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">توضیحات</label>
                <input type="text" value={paymentDesc} onChange={e => setPaymentDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button onClick={() => setPaymentStudent(null)} className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer">انصراف</button>
              <button onClick={handleSavePayment} disabled={isSubmittingPay || !paymentAmount}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition flex items-center gap-1.5 cursor-pointer">
                {isSubmittingPay ? 'در حال ثبت...' : <><CreditCard className="w-3.5 h-3.5" />ثبت قطعی</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Delete Confirm */}
      {deleteConfirmStudent && (
        <div className="carla-modal-overlay">
          <div className="carla-modal p-6 text-center space-y-4" style={{ maxWidth: 400 }}>
            <div className="w-14 h-14 rounded-2xl bg-rose-100 flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7 text-rose-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 mb-1">حذف پرونده</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                پرونده <strong className="text-rose-600">{deleteConfirmStudent.first_name} {deleteConfirmStudent.last_name}</strong> به همراه تمام سوابق و تراکنش‌های مالی حذف خواهد شد. این عملیات قابل بازگشت نیست.
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmStudent(null)} className="px-5 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer">انصراف</button>
              <button onClick={() => handleDeleteStudent(deleteConfirmStudent.id)} className="px-6 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition cursor-pointer shadow-sm">حذف قطعی</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
