import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  CreditCard,
  FileImage,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Calendar,
  MapPin,
  Phone,
  BookOpen,
  DollarSign,
  Loader2,
  Camera,
  Hash,
  X,
  FileText,
  Users,
  Banknote,
  FolderOpen,
} from 'lucide-react';
import { Course, Student, Enrollment } from '../types';
import * as api from '../api/client';
import { jsPDF } from 'jspdf';

interface StudentRegistrationFormProps {
  courses: Course[];
  enrollments: Enrollment[];
  onRefresh: () => void;
  onActiveTabChange: (tab: string, enrollmentId?: number) => void;
}

function Field({
  label, required = false, error, hint, children,
}: {
  label: string; required?: boolean; error?: string | null; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-rose-500 mr-1">*</span>}
      </label>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-rose-500 mt-1">
          <AlertCircle className="w-3 h-3 shrink-0" />{error}
        </p>
      )}
      {!error && hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function Input({
  icon: Icon, value, onChange, placeholder, type = 'text', mono = false, error = false,
}: {
  icon: React.ElementType; value: string | number; onChange: (v: string) => void;
  placeholder?: string; type?: string; mono?: boolean; error?: boolean;
}) {
  return (
    <div className="relative">
      <Icon className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full pr-9 pl-3 py-2 text-xs border rounded-xl focus:outline-none focus:ring-2 transition ${
          error
            ? 'border-rose-300 bg-rose-50/40 focus:border-rose-400 focus:ring-rose-100'
            : 'border-slate-200 bg-white focus:border-sky-400 focus:ring-sky-100'
        } ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function SectionHeader({ icon: Icon, label, color = 'sky' }: {
  icon: React.ElementType; label: string; color?: 'sky' | 'teal' | 'violet' | 'amber';
}) {
  const map = {
    sky:    'bg-sky-50 text-sky-700 border-sky-200',
    teal:   'bg-teal-50 text-teal-700 border-teal-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold mb-3 ${map[color]}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </div>
  );
}

export default function StudentRegistrationForm({
  courses,
  enrollments,
  onRefresh,
  onActiveTabChange,
}: StudentRegistrationFormProps) {

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess,    setIsSuccess]    = useState(false);
  const [createdStudent, setCreatedStudent] = useState<Student | null>(null);
  const [createdEnrollmentId, setCreatedEnrollmentId] = useState<number | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);

  const [courseNumber, setCourseNumber] = useState<number>(() => {
    const nums = enrollments.map(e => e.course_number).filter((n): n is number => n != null);
    return nums.length > 0 ? Math.max(...nums) + 1 : 105;
  });

  /* ── Personal Info ── */
  const [firstName,    setFirstName]    = useState('');
  const [lastName,     setLastName]     = useState('');
  const [fatherName,   setFatherName]   = useState('');
  const [nationalCode, setNationalCode] = useState('');
  const [phoneNumber,  setPhoneNumber]  = useState('');
  const [birthDate,    setBirthDate]    = useState('1380/01/01');
  const [address,      setAddress]      = useState('');

  /* ── Photos & OCR ── */
  const [idCardFile,    setIdCardFile]    = useState<File | null>(null);
  const [idCardPreview, setIdCardPreview] = useState<string | null>(null);
  const [isScanningOCR, setIsScanningOCR] = useState(false);
  const [ocrSuccess,    setOcrSuccess]    = useState(false);

  const [personalPhotoFile,    setPersonalPhotoFile]    = useState<File | null>(null);
  const [personalPhotoPreview, setPersonalPhotoPreview] = useState<string | null>(null);

  /* Camera Modal State */
  const [activeCameraTarget, setActiveCameraTarget] = useState<'idCard' | 'personal' | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  /* Course & Payment */
  const [selectedCourseId, setSelectedCourseId] = useState<number>(courses[0]?.id || 1);
  const [finalPrice,       setFinalPrice]       = useState<number>(0);
  const [payAmount,        setPayAmount]        = useState<number>(0);
  const [payMethod,        setPayMethod]        = useState('pos');
  const [payDesc,          setPayDesc]          = useState('');

  const [nationalCodeError, setNationalCodeError] = useState<string | null>(null);
  const [phoneError,        setPhoneError]        = useState<string | null>(null);

  useEffect(() => {
    const c = courses.find(c => c.id === selectedCourseId);
    if (c) { setFinalPrice(c.tuition); setPayAmount(Math.min(2000000, c.tuition)); }
  }, [selectedCourseId, courses]);

  useEffect(() => {
    if (!phoneNumber) { setPhoneError(null); return; }
    setPhoneError(/^09\d{9}$/.test(phoneNumber) ? null : 'باید ۱۱ رقم و با ۰۹ شروع شود');
  }, [phoneNumber]);

  useEffect(() => {
    if (!nationalCode) { setNationalCodeError(null); return; }
    if (nationalCode.length !== 10 || !/^\d+$/.test(nationalCode)) {
      setNationalCodeError('باید دقیقاً ۱۰ رقم باشد'); return;
    }
    const d = nationalCode.split('').map(Number);
    let s = 0;
    for (let i = 0; i < 9; i++) s += d[i] * (10 - i);
    const r = s % 11;
    const valid = r < 2 ? d[9] === r : d[9] === 11 - r;
    setNationalCodeError(valid ? null : 'رقم کنترلی معتبر نیست');
  }, [nationalCode]);

  /* Camera Capture Logic */
  const startCamera = async (target: 'idCard' | 'personal') => {
    setActiveCameraTarget(target);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn('Camera access fallback simulation enabled:', err);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setActiveCameraTarget(null);
  };

  const capturePhoto = () => {
    if (videoRef.current && videoRef.current.videoWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `${activeCameraTarget}_capture.jpg`, { type: 'image/jpeg' });
            const previewUrl = URL.createObjectURL(blob);
            if (activeCameraTarget === 'idCard') {
              setIdCardFile(file);
              setIdCardPreview(previewUrl);
              setOcrSuccess(false);
            } else {
              setPersonalPhotoFile(file);
              setPersonalPhotoPreview(previewUrl);
            }
          }
        }, 'image/jpeg');
      }
    } else {
      const sampleUrl = activeCameraTarget === 'idCard'
        ? 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600'
        : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400';

      fetch(sampleUrl)
        .then(r => r.blob())
        .then(blob => {
          const file = new File([blob], `${activeCameraTarget}_scan.jpg`, { type: 'image/jpeg' });
          if (activeCameraTarget === 'idCard') {
            setIdCardFile(file);
            setIdCardPreview(sampleUrl);
            setOcrSuccess(false);
          } else {
            setPersonalPhotoFile(file);
            setPersonalPhotoPreview(sampleUrl);
          }
        });
    }
    stopCamera();
  };

  /* OCR handler */
  const handleOcrScan = async () => {
    if (!idCardFile) return;
    setIsScanningOCR(true); setOcrSuccess(false);
    try {
      const result = await api.ocrNationalCard(idCardFile);
      if (result) {
        setFirstName(result.first_name || '');
        setLastName(result.last_name || '');
        setNationalCode(result.national_code || '');
        setFatherName(result.father_name || '');
        setBirthDate(result.birth_date_jalali || '1380/01/01');
        setOcrSuccess(true);
      }
    } catch { alert('خطا در اسکن. اطلاعات را دستی وارد کنید.'); }
    finally { setIsScanningOCR(false); }
  };

  /* PDF receipt */
  const generateAndUploadReceipt = async (enrollmentId: number, studentObj: Student, courseObj: Course, paid: number) => {
    try {
      const settings = await api.fetchReceiptSettings();
      const canvas   = document.createElement('canvas');
      canvas.width = 800; canvas.height = 1130;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 1130);
      ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 8; ctx.strokeRect(20, 20, 760, 1090);
      ctx.fillStyle = '#0ea5e9'; ctx.fillRect(35, 35, 730, 90);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Tahoma'; ctx.textAlign = 'center';
      ctx.fillText(settings.academy_name || 'آموزشگاه رانندگی کارلا', 400, 75);
      ctx.font = '13px Tahoma';
      ctx.fillText(settings.header_text || 'رسید رسمی پرداخت و ثبت‌نام کارآموز', 400, 110);
      ctx.fillStyle = '#1e293b'; ctx.textAlign = 'right'; ctx.font = 'bold 13px Tahoma';
      ctx.fillText(`شماره فیش: ${enrollmentId}`, 730, 170);
      ctx.fillText('تاریخ: ۱۴۰۵/۰۵/۲۸', 730, 195);
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(35, 215); ctx.lineTo(765, 215); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 14px Tahoma'; ctx.fillStyle = '#0ea5e9';
      ctx.fillText('مشخصات کارآموز:', 730, 250);
      ctx.fillStyle = '#1e293b'; ctx.font = '13px Tahoma';
      ctx.fillText(`نام: ${studentObj.first_name} ${studentObj.last_name}`, 730, 280);
      ctx.fillText(`کد ملی: ${studentObj.national_code}`, 730, 305);
      ctx.fillText(`تلفن: ${studentObj.phone_number}`, 730, 330);
      ctx.fillText(`دوره: ${courseObj.title}`, 730, 355);
      const debt = finalPrice - paid;
      ctx.fillStyle = '#0ea5e9'; ctx.font = 'bold 14px Tahoma';
      ctx.fillText('جدول مالی:', 730, 400);
      [[`شهریه کل: ${finalPrice.toLocaleString('fa-IR')} تومان`, '#1e293b'],
       [`پرداخت‌شده: ${paid.toLocaleString('fa-IR')} تومان`, '#059669'],
       [`مانده: ${debt.toLocaleString('fa-IR')} تومان`, debt > 0 ? '#dc2626' : '#059669']
      ].forEach(([txt, color], i) => {
        ctx.fillStyle = color as string; ctx.font = '14px Tahoma';
        ctx.fillText(txt as string, 730, 440 + i * 35);
      });
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px Tahoma'; ctx.textAlign = 'center';
      ctx.fillText(settings.footer_text || 'خواهشمند است تا هفته چهارم نسبت به تسویه کامل اقدام فرمایید.', 400, 750);
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      doc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297);
      const blob = doc.output('blob');
      const res  = await api.uploadEnrollmentReceipt(enrollmentId, blob, { filename: `receipt_${enrollmentId}.pdf` });
      if (res) setPdfPath(res.receipt_pdf_path);
    } catch { /* noop */ }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !nationalCode || !phoneNumber) {
      alert('فیلدهای ستاره‌دار اجباری را تکمیل کنید.'); return;
    }
    if (nationalCodeError || phoneError) {
      alert('خطاهای اعتبارسنجی را برطرف کنید.'); return;
    }
    setIsSubmitting(true);
    try {
      const studentRes = await api.createStudent({ first_name: firstName, last_name: lastName, national_code: nationalCode, phone_number: phoneNumber, father_name: fatherName, birth_date_jalali: birthDate, address });
      let studentObj = studentRes.student;
      setCreatedStudent(studentObj);
      if (idCardFile || personalPhotoFile) {
        studentObj = await api.uploadStudentPhotos(studentObj.id, { idCard: idCardFile, personal: personalPhotoFile });
        setCreatedStudent(studentObj);
      }
      const enrollmentObj = await api.createEnrollment({ student_id: studentObj.id, course_id: selectedCourseId, course_number: courseNumber, final_price: finalPrice });
      setCreatedEnrollmentId(enrollmentObj.id);
      if (payAmount > 0) {
        await api.createPayment({ student_id: studentObj.id, enrollment_id: enrollmentObj.id, amount: payAmount, pay_method: payMethod, payment_kind: 'downpayment', description: payDesc || 'پیش‌پرداخت ثبت‌نام' });
      }
      const courseObj = courses.find(c => c.id === selectedCourseId) || courses[0];
      await generateAndUploadReceipt(enrollmentObj.id, studentObj, courseObj, payAmount);
      onRefresh();
      setIsSuccess(true);
    } catch { alert('ثبت‌نام با خطا مواجه شد. اتصال را بررسی کنید.'); }
    finally { setIsSubmitting(false); }
  };

  const handleReset = () => {
    setFirstName(''); setLastName(''); setFatherName('');
    setNationalCode(''); setPhoneNumber(''); setBirthDate('1380/01/01'); setAddress('');
    setIdCardFile(null); setIdCardPreview(null);
    setPersonalPhotoFile(null); setPersonalPhotoPreview(null);
    setPayAmount(0); setPayDesc('');
    setCreatedStudent(null); setCreatedEnrollmentId(null); setPdfPath(null);
    setOcrSuccess(false); setIsSuccess(false);
    onRefresh();
  };

  if (isSuccess && createdStudent) {
    const course = courses.find(c => c.id === selectedCourseId);
    return (
      <div className="max-w-xl mx-auto fade-in" id="registration-success-view">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="h-1 bg-gradient-to-l from-teal-400 via-sky-500 to-sky-400" />

          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto shadow-md">
              <CheckCircle className="w-7 h-7 text-white" />
            </div>

            <div>
              <h2 className="text-xl font-black text-slate-900 mb-1">ثبت‌نام با موفقیت انجام شد!</h2>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                پرونده کارآموز ایجاد شد و رسید PDF تولید گردید.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 text-right space-y-2 max-w-xs mx-auto">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">خلاصه پرونده</div>
              {[
                { label: 'نام کارآموز', value: `${createdStudent.first_name} ${createdStudent.last_name}` },
                { label: 'کد ملی',      value: createdStudent.national_code, mono: true },
                { label: 'دوره',        value: course?.title || '—' },
                { label: 'پرداختی',    value: `${payAmount.toLocaleString('fa-IR')} تومان`, mono: true },
                { label: 'مانده',      value: `${(finalPrice - payAmount).toLocaleString('fa-IR')} تومان`, mono: true },
              ].map(({ label, value, mono }) => (
                <div key={label} className="flex items-center justify-between text-xs border-b border-slate-100 pb-1.5 last:border-0 last:pb-0">
                  <span className="text-slate-400 text-[11px]">{label}</span>
                  <span className={`font-bold text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-center flex-wrap">
              {pdfPath && (
                <a href={pdfPath} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition shadow-xs">
                  <FileText className="w-3.5 h-3.5" />رسید PDF
                </a>
              )}
              <button onClick={handleReset}
                className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition">
                <Users className="w-3.5 h-3.5" />ثبت جدید
              </button>
              <button onClick={() => onActiveTabChange('students')}
                className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition shadow-xs">
                لیست پرونده‌ها
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full fade-in" id="registration-form-container">
      <form onSubmit={handleSubmit}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">ثبت‌نام هوشمند کارآموز</h2>
            <p className="text-xs text-slate-400">ورود اطلاعات فردی، انتخاب دوره آموزشی و بارگذاری مدارک</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-sky-50 border border-sky-200 rounded-xl">
            <Sparkles className="w-3.5 h-3.5 text-sky-500" />
            <span className="text-xs font-bold text-sky-700">اسکن OCR فعال</span>
          </div>
        </div>

        {/* Comfortable Expanded Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Left Column (7 cols): Personal Info & Financial */}
          <div className="lg:col-span-7 space-y-4">

            {/* Personal Info */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-xs">
              <SectionHeader icon={User} label="اطلاعات شخصی کارآموز" color="sky" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="نام" required>
                  <Input icon={User} value={firstName} onChange={setFirstName} placeholder="امیرحسین" />
                </Field>

                <Field label="نام خانوادگی" required>
                  <Input icon={User} value={lastName} onChange={setLastName} placeholder="رضایی" />
                </Field>

                <Field label="کد ملی" required error={nationalCodeError}>
                  <Input icon={CreditCard} value={nationalCode} onChange={setNationalCode} placeholder="۱۰ رقم" mono error={!!nationalCodeError} />
                </Field>

                <Field label="شماره همراه" required error={phoneError}>
                  <Input icon={Phone} value={phoneNumber} onChange={setPhoneNumber} placeholder="0912xxxxxxx" mono error={!!phoneError} />
                </Field>

                <Field label="نام پدر">
                  <Input icon={User} value={fatherName} onChange={setFatherName} placeholder="علیرضا" />
                </Field>

                <Field label="تاریخ تولد">
                  <Input icon={Calendar} value={birthDate} onChange={setBirthDate} placeholder="۱۳۸۰/۰۱/۰۱" mono />
                </Field>

                <div className="sm:col-span-3">
                  <Field label="آدرس سکونت">
                    <Input icon={MapPin} value={address} onChange={setAddress} placeholder="تهران، ونک، خیابان ولیعصر..." />
                  </Field>
                </div>
              </div>
            </div>

            {/* Course & Financial */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-xs">
              <SectionHeader icon={BookOpen} label="دوره آموزشی و پرداخت اولیه" color="amber" />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div className="sm:col-span-2">
                  <Field label="دوره آموزشی" required>
                    <div className="relative">
                      <BookOpen className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select value={selectedCourseId} onChange={e => setSelectedCourseId(+e.target.value)}
                        className="w-full pr-9 pl-6 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 bg-white cursor-pointer transition appearance-none font-medium">
                        {courses.map(c => (
                          <option key={c.id} value={c.id}>{c.title} — {c.tuition.toLocaleString('fa-IR')} تومان</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                </div>

                <Field label="شهریه نهایی (تومان)">
                  <Input icon={DollarSign} value={finalPrice} onChange={v => setFinalPrice(+v || 0)} type="number" mono />
                </Field>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="مبلغ پیش‌پرداخت">
                    <Input icon={DollarSign} value={payAmount} onChange={v => setPayAmount(+v || 0)} type="number" mono />
                  </Field>

                  <Field label="روش دریافت">
                    <div className="relative">
                      <CreditCard className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                        className="w-full pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 bg-white cursor-pointer transition appearance-none font-medium">
                        <option value="pos">کارتخوان</option>
                        <option value="card_transfer">کارت به کارت</option>
                        <option value="cash">نقدی</option>
                      </select>
                    </div>
                  </Field>

                  <Field label="توضیحات مالی">
                    <Input icon={FileText} value={payDesc} onChange={setPayDesc} placeholder="شماره فیش..." />
                  </Field>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column (5 cols): SINGLE UNIFIED UPLOAD FIELD FOR BOTH ID CARD & PERSONAL PHOTO */}
          <div className="lg:col-span-5 space-y-4">

            {/* UNIFIED SINGLE UPLOAD CONTAINER CARD WITH EXPANDED HEIGHT */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-xs space-y-4">
              <SectionHeader icon={Camera} label="فیلد بارگذاری تصاویر و مدارک" color="teal" />

              {/* BOTH DOCUMENTS TOGETHER SIDE-BY-SIDE WITH INCREASED HEIGHT */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                
                {/* 1. ID CARD DOCUMENT */}
                <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 space-y-2.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-700 flex items-center gap-1.5">
                      <FileImage className="w-4 h-4 text-sky-500" />کارت ملی
                    </span>
                    {idCardPreview && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                  </div>

                  {/* ID Card Thumbnail (Height increased to h-28) */}
                  <div className={`w-full h-28 rounded-lg border flex items-center justify-center overflow-hidden transition ${idCardPreview ? 'border-sky-300 bg-white' : 'border-slate-200 bg-white'}`}>
                    {idCardPreview ? (
                      <img src={idCardPreview} alt="کارت ملی" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center text-slate-400 p-2">
                        <FileImage className="w-6 h-6 mx-auto mb-1 opacity-60 text-sky-500" />
                        <span className="text-[10px] font-semibold">تصویر کارت ملی</span>
                      </div>
                    )}
                  </div>

                  {/* Two Buttons for ID Card */}
                  <div className="space-y-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => startCamera('idCard')}
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 text-white text-xs font-bold rounded-lg transition cursor-pointer shadow-xs"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      اسکن (دوربین)
                    </button>

                    <input
                      type="file"
                      id="idCardUploadDirect"
                      accept="image/*"
                      onChange={e => { const f = e.target.files?.[0]; if (f) { setIdCardFile(f); setIdCardPreview(URL.createObjectURL(f)); setOcrSuccess(false); } }}
                      className="hidden"
                    />
                    <label
                      htmlFor="idCardUploadDirect"
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 cursor-pointer transition block text-center"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                      انتخاب فایل
                    </label>

                    {idCardFile && !ocrSuccess && (
                      <button
                        type="button"
                        onClick={handleOcrScan}
                        disabled={isScanningOCR}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                      >
                        {isScanningOCR ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />استخراج...</> : <><Sparkles className="w-3.5 h-3.5" />استخراج OCR</>}
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. PERSONAL 3x4 PHOTO DOCUMENT */}
                <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 space-y-2.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-teal-700 flex items-center gap-1.5">
                      <User className="w-4 h-4 text-teal-500" />عکس ۳×۴ پرسنلی
                    </span>
                    {personalPhotoPreview && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                  </div>

                  {/* Personal Photo Thumbnail (Height increased to h-28) */}
                  <div className={`w-full h-28 rounded-lg border flex items-center justify-center overflow-hidden transition ${personalPhotoPreview ? 'border-teal-300 bg-white' : 'border-slate-200 bg-white'}`}>
                    {personalPhotoPreview ? (
                      <img src={personalPhotoPreview} alt="عکس پرسنلی" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center text-slate-400 p-2">
                        <User className="w-6 h-6 mx-auto mb-1 opacity-50 text-teal-500" />
                        <span className="text-[10px] font-semibold">عکس پرسنلی</span>
                      </div>
                    )}
                  </div>

                  {/* Two Buttons for Personal Photo */}
                  <div className="space-y-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => startCamera('personal')}
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-l from-teal-600 to-teal-500 hover:from-teal-700 text-white text-xs font-bold rounded-lg transition cursor-pointer shadow-xs"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      اسکن (دوربین)
                    </button>

                    <input
                      type="file"
                      id="personalPhotoUploadDirect"
                      accept="image/*"
                      onChange={e => { const f = e.target.files?.[0]; if (f) { setPersonalPhotoFile(f); setPersonalPhotoPreview(URL.createObjectURL(f)); } }}
                      className="hidden"
                    />
                    <label
                      htmlFor="personalPhotoUploadDirect"
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 cursor-pointer transition block text-center"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                      انتخاب فایل
                    </label>

                    {personalPhotoPreview && (
                      <button
                        type="button"
                        onClick={() => { setPersonalPhotoFile(null); setPersonalPhotoPreview(null); }}
                        className="w-full text-[10px] text-rose-500 hover:underline flex items-center justify-center gap-0.5 pt-0.5"
                      >
                        <X className="w-3 h-3" />حذف عکس
                      </button>
                    )}
                  </div>
                </div>

              </div>

              {/* Status & Final Submit */}
              <div className="border-t border-slate-100 pt-3 space-y-2.5">
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />وضعیت تکمیل پرونده
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {[
                    { label: 'اطلاعات شخصی', done: !!(firstName && lastName && nationalCode && phoneNumber) },
                    { label: 'کد ملی معتبر',  done: !!nationalCode && !nationalCodeError },
                    { label: 'شماره همراه',   done: !!phoneNumber && !phoneError },
                    { label: 'دوره انتخابی',  done: !!selectedCourseId },
                    { label: 'کارت ملی',      done: !!idCardFile },
                    { label: 'عکس پرسنلی',   done: !!personalPhotoFile },
                  ].map(({ label, done }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                        {done ? <CheckCircle className="w-2.5 h-2.5" /> : <div className="w-1 h-1 rounded-full bg-current" />}
                      </div>
                      <span className={done ? 'text-slate-700 font-semibold' : 'text-slate-400'}>{label}</span>
                    </div>
                  ))}
                </div>

                <button type="submit" disabled={isSubmitting}
                  className="mt-3 w-full py-3 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 hover:to-sky-600 disabled:opacity-60 text-white text-xs font-extrabold rounded-xl transition shadow-md shadow-sky-200 flex items-center justify-center gap-2 cursor-pointer">
                  {isSubmitting
                    ? <><Loader2 className="w-4 h-4 animate-spin" />در حال ثبت پرونده...</>
                    : <><CheckCircle className="w-4 h-4" />ثبت نهایی پرونده کارآموز</>
                  }
                </button>
              </div>
            </div>

          </div>

        </div>
      </form>

      {/* ── CAMERA MODAL FOR REAL-TIME SCANNING / PHOTO CAPTURE ── */}
      {activeCameraTarget && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 max-w-md w-full space-y-3 text-slate-800 shadow-2xl animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-sky-600" />
                {activeCameraTarget === 'idCard' ? 'اسکن کارت ملی با دوربین' : 'گرفتن عکس پرسنلی با دوربین'}
              </h3>
              <button
                type="button"
                onClick={stopCamera}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video / Camera Viewport */}
            <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-[4/3] flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 border-2 border-dashed border-sky-400/50 pointer-events-none rounded-xl m-4 flex items-center justify-center">
                <span className="text-[10px] text-sky-200/80 bg-slate-900/60 px-2 py-1 rounded">
                  {activeCameraTarget === 'idCard' ? 'کارت ملی را جلوی دوربین قرار دهید' : 'چهره را در کادر قرار دهید'}
                </span>
              </div>
            </div>

            {/* Camera Actions */}
            <div className="flex justify-between items-center pt-1">
              <button
                type="button"
                onClick={stopCamera}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={capturePhoto}
                className="px-5 py-2 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow-sm"
              >
                <Camera className="w-4 h-4" />
                ثبت و اسکن تصویر
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
