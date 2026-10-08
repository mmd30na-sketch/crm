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
  X,
  FileText,
  Users,
  FolderOpen,
  Inbox,
  ChevronLeft,
  ChevronRight,
  RotateCw,
} from 'lucide-react';
import { Course, Student, Enrollment, WebsiteRegistration } from '../types';
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
      <label className="block text-sm font-semibold text-slate-700 mb-2">
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

function toLatinDigits(v: string): string {
  return v
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function Input({
  icon: Icon, value, onChange, placeholder, type = 'text', mono = false, error = false,
  inputMode, autoComplete, id, maxLength, disabled = false, currency = false,
}: {
  icon: React.ElementType; value: string | number; onChange: (v: string) => void;
  placeholder?: string; type?: string; mono?: boolean; error?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string; id?: string; maxLength?: number; disabled?: boolean;
  /** Numeric amount: shown with thousands separators, emitted as plain digits. */
  currency?: boolean;
}) {
  const shown = currency && value !== '' && value != null
    ? Number(toLatinDigits(String(value)).replace(/\D/g, '') || 0).toLocaleString('en-US')
    : value;
  return (
    <div className="relative">
      <Icon className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        id={id}
        type={type}
        inputMode={currency ? 'numeric' : inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={error || undefined}
        value={shown}
        onChange={e => onChange(currency ? toLatinDigits(e.target.value).replace(/\D/g, '') : e.target.value)}
        placeholder={placeholder}
        className={`w-full min-h-[52px] pr-11 pl-4 text-sm font-medium border rounded-2xl focus:outline-none focus:ring-2 focus:ring-offset-1 transition-all shadow-sm disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
          error
            ? 'border-rose-300 bg-rose-50/40 focus:border-rose-400 focus:ring-rose-100'
            : 'border-slate-200 bg-white focus:border-sky-400 focus:ring-sky-100'
        } ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function jalaliToday(): string {
  const mapped = toLatinDigits(new Date().toLocaleDateString('fa-IR'));
  const m = mapped.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return mapped;
  return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
}

/** Iranian national smart card (کارت ملی هوشمند) is ISO/IEC 7810 ID-1. */
const IRAN_ID_CARD_MM = { width: 85.6, height: 53.98 };
const IRAN_ID_CARD_RATIO = IRAN_ID_CARD_MM.width / IRAN_ID_CARD_MM.height;
/** Official Iranian personnel photo: 3cm wide × 4cm tall (portrait). */
const PHOTO_3X4_CM = { width: 3, height: 4 };
const PHOTO_3X4_RATIO = PHOTO_3X4_CM.width / PHOTO_3X4_CM.height;

function cropVideoToRatio(video: HTMLVideoElement, ratio: number) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const srcRatio = vw / vh;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (srcRatio > ratio) {
    sw = vh * ratio;
    sx = (vw - sw) / 2;
  } else {
    sh = vw / ratio;
    sy = (vh - sh) / 2;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropImageFileToRatio(file: File, ratio: number): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const srcRatio = img.width / img.height;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (srcRatio > ratio) {
        sw = img.height * ratio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / ratio;
        sy = (img.height - sh) / 2;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) { resolve(file); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '_3x4.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function splitFullName(fullName: string) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
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
    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold mb-4 ${map[color]}`}>
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

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent));
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<'new'|'print'>('new');
  const [isSuccess,    setIsSuccess]    = useState(false);
  const [createdStudent, setCreatedStudent] = useState<Student | null>(null);
  const [createdEnrollmentId, setCreatedEnrollmentId] = useState<number | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);

  const maxCourseNum = enrollments.map(e => e.course_number).filter((n): n is number => n != null).reduce((a,b) => Math.max(a,b), 0);
  const currentMax = maxCourseNum > 0 ? maxCourseNum : 105;
  const [courseNumber, setCourseNumber] = useState<number>(currentMax);
  const courseNumberTouched = useRef(false);
  const [showNewCoursePrompt, setShowNewCoursePrompt] = useState<boolean>(false);

  // Enrollments load asynchronously: follow the highest course number until the user edits it.
  useEffect(() => {
    if (!courseNumberTouched.current) setCourseNumber(currentMax);
  }, [currentMax]);

  /* ── Personal Info ── */
  const [firstName,    setFirstName]    = useState('');
  const [lastName,     setLastName]     = useState('');
  const [fatherName,   setFatherName]   = useState('');
  const [nationalCode, setNationalCode] = useState('');
  const [phoneNumber,  setPhoneNumber]  = useState('');
  const [birthDate,    setBirthDate]    = useState('');
  const [address,      setAddress]      = useState('');
  const [pendingRegs,  setPendingRegs]  = useState<WebsiteRegistration[]>([]);
  const [selectedRegId, setSelectedRegId] = useState<number | null>(null);
  const [regQuery,     setRegQuery]     = useState('');

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
  const [isPortrait, setIsPortrait] = useState(false);

  /* Course & Payment */
  const [selectedCourseId, setSelectedCourseId] = useState<number>(courses[0]?.id || 1);
  const [signupDate, setSignupDate] = useState(() => {
    const d = new Date();
    return d.toLocaleDateString('fa-IR-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
  });
  const [finalPrice,       setFinalPrice]       = useState<number>(0);
  const [hasDiscount,      setHasDiscount]      = useState<boolean>(false);
  const [discountAmount,   setDiscountAmount]   = useState<number>(0);
  const [paymentType,      setPaymentType]      = useState<'full'|'partial'>('full');
  const [payAmount,        setPayAmount]        = useState<number>(0);
  const [payMethod,        setPayMethod]        = useState('pos');
  const [payDesc,          setPayDesc]          = useState('');

  const [nationalCodeError, setNationalCodeError] = useState<string | null>(null);
  const [phoneError,        setPhoneError]        = useState<string | null>(null);
  const [stepError,         setStepError]         = useState<string | null>(null);
  const [ocrError,          setOcrError]          = useState<string | null>(null);

  // Courses may arrive after mount; fall back to the first one if the selection is unknown.
  useEffect(() => {
    if (courses.length > 0 && !courses.some(c => c.id === selectedCourseId)) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, selectedCourseId]);

  useEffect(() => {
    const c = courses.find(c => c.id === selectedCourseId);
    if (!c) return;
    const discount = hasDiscount ? Math.min(discountAmount, c.tuition) : 0;
    setFinalPrice(Math.max(0, c.tuition - discount));
  }, [selectedCourseId, courses, hasDiscount, discountAmount]);

  useEffect(() => {
    api.fetchRegistrations()
      .then((rows) => setPendingRegs(rows.filter((r) => r.status === 'pending' && !r.student_id)))
      .catch(() => setPendingRegs([]));
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
    return () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraStream]);

  useEffect(() => {
    if (!activeCameraTarget) {
      setIsPortrait(false);
      return;
    }
    const sync = () => setIsPortrait(window.matchMedia('(orientation: portrait)').matches);
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, [activeCameraTarget]);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: target === 'idCard'
          ? {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              aspectRatio: { ideal: IRAN_ID_CARD_RATIO },
            }
          : {
              facingMode: { ideal: 'user' },
              width: { ideal: 1080 },
              height: { ideal: 1440 },
              aspectRatio: { ideal: PHOTO_3X4_RATIO },
            },
      });
      setCameraStream(stream);
      try {
        const lock = (screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> }).lock;
        await lock?.(target === 'idCard' ? 'landscape' : 'portrait');
      } catch { /* browsers may ignore lock outside fullscreen */ }
    } catch (err) {
      console.warn('Camera access denied:', err);
      setActiveCameraTarget(null);
      setOcrError('دسترسی به دوربین ممکن نشد — از «انتخاب فایل» استفاده کنید.');
      return;
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setActiveCameraTarget(null);
    try { screen.orientation.unlock(); } catch { /* noop */ }
  };

  const capturePhoto = () => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) {
      setOcrError('تصویر دوربین هنوز آماده نیست — چند لحظه صبر کنید یا فایل را دستی انتخاب کنید.');
      return;
    }
    const target = activeCameraTarget;
    const ratio = target === 'idCard' ? IRAN_ID_CARD_RATIO : PHOTO_3X4_RATIO;
    const canvas = cropVideoToRatio(videoRef.current, ratio);
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `${target}_capture.jpg`, { type: 'image/jpeg' });
      const previewUrl = URL.createObjectURL(blob);
      if (target === 'idCard') {
        setIdCardFile(file);
        setIdCardPreview(previewUrl);
        setOcrSuccess(false);
        void runOcr(file);
      } else {
        setPersonalPhotoFile(file);
        setPersonalPhotoPreview(previewUrl);
      }
    }, 'image/jpeg', 0.92);
    stopCamera();
  };

  const applyPendingRegistration = (reg: WebsiteRegistration) => {
    const names = splitFullName(reg.full_name);
    setSelectedRegId(reg.id);
    setFirstName(names.first);
    setLastName(names.last);
    setNationalCode(reg.national_code || '');
    setPhoneNumber(reg.phone_number || '');
    if (reg.national_card_path) {
      setIdCardPreview(reg.national_card_path);
      setIdCardFile(null);
    }
    if (reg.personal_photo_path) {
      setPersonalPhotoPreview(reg.personal_photo_path);
      setPersonalPhotoFile(null);
    }
  };

  const assignIdCard = (file: File) => {
    setIdCardFile(file);
    setIdCardPreview(URL.createObjectURL(file));
    setOcrSuccess(false);
    void runOcr(file);
  };

  const assignPersonalPhoto = async (file: File) => {
    const cropped = await cropImageFileToRatio(file, PHOTO_3X4_RATIO);
    setPersonalPhotoFile(cropped);
    setPersonalPhotoPreview(URL.createObjectURL(cropped));
  };

  /* OCR handler */
  const runOcr = async (file?: File | null) => {
    const target = file || idCardFile;
    if (!target) return;
    setIsScanningOCR(true); setOcrSuccess(false); setOcrError(null);
    try {
      const result = await api.ocrNationalCard(target);
      const hasAny = !!(result.first_name || result.last_name || result.national_code);
      if (!hasAny) {
        setOcrError('خواندن کارت ملی ناموفق بود. اطلاعات را دستی وارد کنید.');
        setOcrSuccess(false);
        return;
      }
      if (result.first_name) setFirstName(result.first_name);
      if (result.last_name) setLastName(result.last_name);
      if (result.national_code) setNationalCode(result.national_code);
      if (result.father_name) setFatherName(result.father_name);
      if (result.birth_date_jalali) setBirthDate(result.birth_date_jalali);
      setOcrSuccess(true);
      setOcrError(null);
    } catch (err: any) {
      setOcrError(err?.message || 'خطا در اسکن. اطلاعات را دستی وارد کنید.');
    }
    finally { setIsScanningOCR(false); }
  };

  /* PDF receipt */
    /* 3-Page Registration Forms PDF: Receipt (P1), Cardex (P2), Contract (P3) */
  const generateAndUploadReceipt = async (enrollmentId: number, studentObj: Student, courseObj: Course, paid: number): Promise<string | null> => {
    try {
      const settings = await api.fetchReceiptSettings();
      const today = jalaliToday();
      let tuitionPrice = finalPrice || courseObj?.tuition || 0;
      const debt = tuitionPrice - paid;
      const statusText = debt <= 0 ? 'تسویه کامل' : 'بدهکار';
      
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Helper function to build high-res page canvas
      const renderPage = (renderContent: (ctx: CanvasRenderingContext2D) => void) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1240;
        canvas.height = 1754;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1240, 1754);
        renderContent(ctx);
        return canvas.toDataURL('image/jpeg', 0.95);
      };

      // Page 1: Receipt
      const p1Img = renderPage((ctx) => {
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 6;
        ctx.strokeRect(40, 40, 1160, 1674);

        ctx.fillStyle = '#eff6ff';
        ctx.fillRect(43, 43, 1154, 160);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 36px Tahoma';
        ctx.textAlign = 'center';
        ctx.fillText(settings.academy_name || 'آموزشگاه رانندگی کارلا', 620, 125);
        ctx.font = '22px Tahoma';
        ctx.fillText(settings.header_text || 'رسید رسمی دریافت وجه و ثبت نام کارآموز', 620, 175);

        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'right';
        ctx.font = 'bold 24px Tahoma';
        ctx.fillText(`تاریخ: ${today}`, 1120, 270);
        ctx.fillText(`شماره ثبت نام: ${courseNumber || enrollmentId}`, 1120, 320);

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(60, 360);
        ctx.lineTo(1180, 360);
        ctx.stroke();

        ctx.fillStyle = '#0284c7';
        ctx.font = 'bold 26px Tahoma';
        ctx.fillText('مشخصات کارآموز و دوره', 1120, 420);

        ctx.fillStyle = '#1e293b';
        ctx.font = '24px Tahoma';
        ctx.fillText(`نام: ${studentObj.first_name}`, 1120, 480);
        ctx.fillText(`نام خانوادگی: ${studentObj.last_name}`, 1120, 530);
        ctx.fillText(`کد ملی: ${studentObj.national_code}`, 1120, 580);
        ctx.fillText(`شماره همراه: ${studentObj.phone_number}`, 1120, 630);
        ctx.fillText(`دوره آموزشی: ${courseObj?.title || 'حمل و نقل جاده ای'}`, 1120, 680);

        ctx.beginPath();
        ctx.moveTo(60, 740);
        ctx.lineTo(1180, 740);
        ctx.stroke();

        ctx.fillStyle = '#0284c7';
        ctx.font = 'bold 26px Tahoma';
        ctx.fillText('وضعیت مالی', 1120, 800);

        ctx.fillStyle = '#1e293b';
        ctx.font = '24px Tahoma';
        ctx.fillText(`شهریه مصوب: ${tuitionPrice.toLocaleString('fa-IR')} تومان`, 1120, 860);
        ctx.fillStyle = '#059669';
        ctx.fillText(`مبلغ پرداختی: ${paid.toLocaleString('fa-IR')} تومان`, 1120, 910);
        ctx.fillStyle = debt > 0 ? '#dc2626' : '#059669';
        ctx.fillText(`مانده: ${debt.toLocaleString('fa-IR')} تومان`, 1120, 960);
        ctx.fillText(`وضعیت تسویه: ${statusText}`, 1120, 1010);

        ctx.fillStyle = '#64748b';
        ctx.font = '20px Tahoma';
        ctx.textAlign = 'center';
        ctx.fillText(settings.footer_text || 'خواهشمند است تا اتمام امتحانات نسبت به تسویه کامل اقدام فرمایید.', 620, 1650);
      });
      if (p1Img) doc.addImage(p1Img, 'JPEG', 0, 0, 210, 297);

      // Page 2: Cardex
      const p2Img = renderPage((ctx) => {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 6;
        ctx.strokeRect(40, 40, 1160, 1674);

        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(43, 43, 1154, 140);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 36px Tahoma';
        ctx.textAlign = 'center';
        ctx.fillText('کاردکس مهارت آموز', 620, 135);

        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'right';
        ctx.font = 'bold 24px Tahoma';
        ctx.fillText(`کد پرونده: ${courseNumber || enrollmentId}`, 1120, 250);
        ctx.fillText(`تاریخ صدور: ${today}`, 1120, 300);

        ctx.fillStyle = '#1e293b';
        ctx.font = '24px Tahoma';
        ctx.fillText(`نام و نام خانوادگی: ${studentObj.first_name} ${studentObj.last_name}`, 1120, 380);
        ctx.fillText(`کد ملی: ${studentObj.national_code}`, 1120, 430);
        ctx.fillText(`شماره تماس: ${studentObj.phone_number}`, 1120, 480);
        ctx.fillText(`رشته / دوره: ${courseObj?.title || 'حمل و نقل جاده ای'}`, 1120, 530);

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(60, 600);
        ctx.lineTo(1180, 600);
        ctx.stroke();

        ctx.fillText(`شهریه کل: ${tuitionPrice.toLocaleString('fa-IR')} تومان`, 1120, 670);
        ctx.fillText(`مبلغ پرداختی: ${paid.toLocaleString('fa-IR')} تومان`, 1120, 720);
        ctx.fillText(`وضعیت حساب: ${statusText}`, 1120, 770);

        ctx.strokeRect(60, 850, 1120, 750);
        ctx.fillStyle = '#475569';
        ctx.font = '22px Tahoma';
        ctx.textAlign = 'center';
        ctx.fillText('جدول جلسات آموزش نظری و عملی / امتحانات و ارزیابی مهارت آموز', 620, 900);
      });
      if (p2Img) {
        doc.addPage();
        doc.addImage(p2Img, 'JPEG', 0, 0, 210, 297);
      }

      // Page 3: Contract
      const p3Img = renderPage((ctx) => {
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 6;
        ctx.strokeRect(40, 40, 1160, 1674);

        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(43, 43, 1154, 140);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 34px Tahoma';
        ctx.textAlign = 'center';
        ctx.fillText('قرارداد ثبت نام دوره آموزشی', 620, 135);

        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'right';
        ctx.font = 'bold 24px Tahoma';
        ctx.fillText(`تاریخ قرارداد: ${today}`, 1120, 250);
        ctx.fillText(`شماره دوره / کلاس: ${courseNumber || enrollmentId}`, 1120, 300);

        ctx.fillStyle = '#1e293b';
        ctx.font = '24px Tahoma';
        ctx.fillText(`نام کارآموز: ${studentObj.first_name} ${studentObj.last_name}`, 1120, 380);
        ctx.fillText(`شماره ملی: ${studentObj.national_code}`, 1120, 430);
        ctx.fillText(`موضوع دوره: ${courseObj?.title || 'حمل و نقل جاده ای'}`, 1120, 480);
        ctx.fillText(`مبلغ قرارداد: ${tuitionPrice.toLocaleString('fa-IR')} تومان`, 1120, 530);

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(60, 590);
        ctx.lineTo(1180, 590);
        ctx.stroke();

        ctx.fillStyle = '#334155';
        ctx.font = '20px Tahoma';
        const terms = [
          '۱. کارآموز متعهد است ضوابط و مقررات آموزشی و انضباطی آموزشگاه را رعایت فرماید.',
          '۲. حضور به موقع در کلاس های نظری و مهارت عملی الزامی می باشد.',
          '۳. تسویه حساب کامل قبل از معرفی به آزمون پایانی دوره الزامی است.',
          '۴. آموزشگاه هیچگونه مسئولیتی در قبال مدارک و اشیاء مفقودی هنرجویان ندارد.'
        ];
        terms.forEach((line, idx) => {
          ctx.fillText(line, 1120, 660 + idx * 55);
        });

        ctx.font = 'bold 22px Tahoma';
        ctx.fillText('امضاء و اثر انگشت کارآموز:', 1100, 1400);
        ctx.textAlign = 'left';
        ctx.fillText('مهر و امضاء امور ثبت نام مدیریت آموزشگاه:', 150, 1400);
      });
      if (p3Img) {
        doc.addPage();
        doc.addImage(p3Img, 'JPEG', 0, 0, 210, 297);
      }

      const blob = doc.output('blob');
      const res  = await api.uploadEnrollmentReceipt(enrollmentId, blob, { filename: `registration_forms_${enrollmentId}.pdf` });
      const path = res?.receipt_pdf_path || null;
      setPdfPath(path);
      return path;
    } catch (err) {
      console.warn('Receipt PDF generation failed:', err);
      return null;
    }
  };

  const handleSubmit = async (mode: 'new'|'print', newCourseConfirmed = false) => {
    setSubmitMode(mode);
    if (!firstName || !lastName || !nationalCode || !phoneNumber) {
      setStepError('فیلدهای ستاره‌دار اجباری را تکمیل کنید.'); return;
    }
    if (nationalCodeError || phoneError) {
      setStepError('خطاهای اعتبارسنجی را برطرف کنید.'); return;
    }
    if (!courses.some(c => c.id === selectedCourseId)) {
      setStepError('دوره آموزشی را انتخاب کنید.'); return;
    }
    if (!courseNumber || courseNumber <= 0) {
      setStepError('شماره دوره را وارد کنید.'); return;
    }
    if (payAmount > finalPrice) {
      setStepError('مبلغ پیش‌پرداخت نمی‌تواند از شهریه نهایی بیشتر باشد.'); return;
    }
    if (courseNumber > currentMax && !newCourseConfirmed) {
      setShowNewCoursePrompt(true);
      return;
    }
    setShowNewCoursePrompt(false);
    setStepError(null);
    setIsSubmitting(true);
    try {
      const today = jalaliToday();
      const studentRes = await api.createStudent({
        first_name: firstName,
        last_name: lastName,
        national_code: nationalCode,
        phone_number: phoneNumber,
        father_name: fatherName,
        birth_date_jalali: birthDate,
        address,
      });
      let studentObj = studentRes.student;
      setCreatedStudent(studentObj);
      if (idCardFile || personalPhotoFile) {
        try {
          const uploaded = await api.uploadStudentPhotos(
            studentObj.id,
            { idCard: idCardFile, personal: personalPhotoFile },
            { last_name: lastName, course_number: courseNumber },
          );
          studentObj = {
            ...studentObj,
            ...uploaded,
            first_name: uploaded.first_name || studentObj.first_name,
            last_name: uploaded.last_name || studentObj.last_name,
            national_code: uploaded.national_code || studentObj.national_code,
            phone_number: uploaded.phone_number || studentObj.phone_number,
          };
          setCreatedStudent(studentObj);
        } catch (photoErr: any) {
          console.warn('Photo upload failed, student record was still created:', photoErr);
          setStepError(photoErr?.message || 'پرونده ثبت شد ولی بارگذاری عکس ناموفق بود.');
        }
      }
      if (selectedRegId) {
        try {
          await api.approveRegistration(selectedRegId, studentObj.id);
          setPendingRegs((rows) => rows.filter((r) => r.id !== selectedRegId));
        } catch (regErr) {
          console.warn('Could not mark website registration approved:', regErr);
        }
      }
      const enrollmentObj = await api.createEnrollment({
        student_id: studentObj.id,
        course_id: selectedCourseId,
        course_number: courseNumber,
        signup_date_jalali: signupDate,
        final_price: finalPrice,
      });
      setCreatedEnrollmentId(enrollmentObj.id);
      if (payAmount > 0) {
        await api.createPayment({
          student_id: studentObj.id,
          enrollment_id: enrollmentObj.id,
          amount: payAmount,
          pay_date_jalali: today,
          pay_method: payMethod,
          payment_kind: paymentType === 'full' ? 'full' : 'downpayment',
          description: payDesc || 'پیش‌پرداخت ثبت‌نام',
        });
      }
      const courseObj = courses.find(c => c.id === selectedCourseId) || courses[0];
      const receiptPath = await generateAndUploadReceipt(enrollmentObj.id, studentObj, courseObj, payAmount);
      onRefresh();
      if (mode === 'print' && receiptPath) window.open(receiptPath, '_blank');
      if (mode === 'new') { handleReset(); return; }
      setIsSuccess(true);
    } catch (err: any) {
      setStepError(err?.message || 'ثبت‌نام با خطا مواجه شد. اتصال را بررسی کنید.');
    }
    finally { setIsSubmitting(false); }
  };

  const handleReset = () => {
    setFirstName(''); setLastName(''); setFatherName('');
    setNationalCode(''); setPhoneNumber(''); setBirthDate(''); setAddress('');
    setSelectedRegId(null); setRegQuery('');
    setIdCardFile(null); setIdCardPreview(null);
    setPersonalPhotoFile(null); setPersonalPhotoPreview(null);
    setPayAmount(0); setPayDesc(''); setPaymentType('full'); setHasDiscount(false); setDiscountAmount(0);
    setCreatedStudent(null); setCreatedEnrollmentId(null); setPdfPath(null);
    setOcrSuccess(false); setOcrError(null); setStepError(null); setIsSuccess(false);
    courseNumberTouched.current = false;
    setCourseNumber(Math.max(currentMax, courseNumber));
    setShowNewCoursePrompt(false);
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
      <form onSubmit={e => e.preventDefault()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">ثبت‌نام هوشمند کارآموز</h2>
            
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-sky-50 border border-sky-200 rounded-xl">
            <Sparkles className="w-3.5 h-3.5 text-sky-500" />
            <span className="text-xs font-bold text-sky-700">اسکن OCR فعال</span>
          </div>
        </div>


        {(stepError || ocrError) && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-xs font-semibold">{stepError || ocrError}</p>
          </div>
        )}

        {pendingRegs.length > 0 && (
          <div className="mb-4 bg-violet-50/70 border border-violet-200 rounded-2xl p-3.5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-800">
                <Inbox className="w-3.5 h-3.5" />
                ثبت‌نام‌های در انتظار وبسایت ({pendingRegs.length})
              </div>
              <input
                value={regQuery}
                onChange={(e) => setRegQuery(e.target.value)}
                placeholder="جستجو نام / کد ملی / موبایل"
                className="w-56 max-w-full px-2.5 py-1.5 text-[11px] border border-violet-200 rounded-lg bg-white"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pendingRegs
                .filter((r) => {
                  const q = regQuery.trim();
                  if (!q) return true;
                  return `${r.full_name} ${r.national_code} ${r.phone_number} ${r.tracking_code}`.includes(q);
                })
                .slice(0, 12)
                .map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => applyPendingRegistration(r)}
                    className={`shrink-0 text-right px-3 py-2 rounded-xl border text-[11px] transition ${
                      selectedRegId === r.id
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-slate-700 border-violet-200 hover:border-violet-400'
                    }`}
                  >
                    <div className="font-bold">{r.full_name || 'بدون نام'}</div>
                    <div className="font-mono opacity-80">{r.national_code}</div>
                    <div className="opacity-70">{r.phone_number}</div>
                  </button>
                ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5 items-start">
              <div className="bg-white/90 border border-sky-100 rounded-3xl p-6 shadow-sm hover:shadow-md transition duration-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="inline-flex items-center gap-1.5 text-sm font-black text-sky-800">
                    <CreditCard className="w-4 h-4" />
                    ثبت کارت ملی
                  </div>
                  {idCardPreview && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                </div>
                
                <div className={`w-full max-w-lg mx-auto aspect-[85.6/53.98] rounded-[14px] border-2 overflow-hidden mb-3 flex items-center justify-center ${idCardPreview ? 'border-sky-400 bg-white' : 'border-dashed border-sky-300 bg-sky-50/50'}`}>
                  {idCardPreview ? (
                    <img src={idCardPreview} alt="کارت ملی" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-sky-400 px-4">
                      <CreditCard className="w-10 h-10 mx-auto mb-1" />
                      <span className="text-sm font-bold block">کادر کارت ملی</span>
                      
                    </div>
                  )}
                </div>
                <input type="file" id="idCardFirstUpload" accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value=''; if (f) assignIdCard(f); }} className="hidden" />
                {isMobile ? (
                  <>
                    <button type="button" onClick={() => startCamera('idCard')} disabled={isScanningOCR}
                      className="w-full py-3 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 disabled:opacity-60 text-white text-sm font-extrabold rounded-xl shadow-sm transition flex items-center justify-center gap-2"
                    >
                      {isScanningOCR ? <><Loader2 className="w-5 h-5 animate-spin" />در حال خواندن کارت ملی...</> : <><Camera className="w-5 h-5" />دوربین گوشی (اسکن کارت)</>}
                    </button>
                    <label htmlFor="idCardFirstUpload" className="mt-2 w-full min-h-11 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 cursor-pointer flex items-center justify-center gap-2">
                      <FolderOpen className="w-4 h-4 text-slate-500" />گالری فایل
                    </label>
                  </>
                ) : (
                  <>
                    <label htmlFor="idCardFirstUpload" className="w-full py-3 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 text-white text-sm font-extrabold rounded-xl cursor-pointer shadow-sm flex items-center justify-center gap-2">
                      <FolderOpen className="w-5 h-5" />انتخاب فایل اسکنشده (پیشفرض)
                    </label>
                    <button type="button" onClick={() => alert('سرویس دسکتاپ اسکنر در حال توسعه است. فعلاً از انتخاب فایل استفاده کنید.')} disabled={isScanningOCR}
                      className="mt-2 w-full min-h-11 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 flex items-center justify-center gap-2"
                    >
                      {isScanningOCR ? <><Loader2 className="w-4 h-4 animate-spin text-sky-600" />در حال پردازش...</> : <><Camera className="w-4 h-4 text-slate-500" />اسکن مستقیم با دستگاه</>}
                    </button>
                  </>
                )}
                {idCardFile && !ocrSuccess && !isScanningOCR && (
                  <button type="button" onClick={() => void runOcr()}
                    className="mt-2 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />استخراج اطلاعات از کارت
                  </button>
                )}
                {ocrSuccess && (
                  <p className="mt-2 text-[11px] text-emerald-600 font-semibold text-center">اطلاعات کارت در فیلدها پر شد. در صورت نیاز اصلاح کنید.</p>
                )}
              </div>

              <div className="bg-white/90 border border-teal-100 rounded-3xl p-6 shadow-sm hover:shadow-md transition duration-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="inline-flex items-center gap-1.5 text-sm font-black text-teal-800">
                    <User className="w-4 h-4" />عکس پرسنلی ۳×۴
                  </div>
                  {personalPhotoPreview && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                </div>
                
                <div className={`w-[168px] mx-auto aspect-[3/4] rounded-xl border-2 overflow-hidden mb-3 flex items-center justify-center ${personalPhotoPreview ? 'border-teal-400 bg-white' : 'border-dashed border-teal-300 bg-teal-50/50'}`}>
                  {personalPhotoPreview ? (
                    <img src={personalPhotoPreview} alt="عکس پرسنلی ۳×۴" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-teal-400 px-2">
                      <User className="w-8 h-8 mx-auto mb-1" />
                      <span className="text-sm font-bold block">عکس پرسنلی</span>
                      <span className="text-[10px] opacity-80">۳ سانتی‌متر × ۴ سانتی‌متر</span>
                    </div>
                  )}
                </div>
                <input type="file" id="personalPhotoFirstUpload" accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value=''; if (f) void assignPersonalPhoto(f); }} className="hidden" />
                {isMobile ? (
                  <>
                    <button type="button" onClick={() => startCamera('personal')}
                      className="w-full py-3 bg-gradient-to-l from-teal-600 to-teal-500 hover:from-teal-700 text-white text-sm font-extrabold rounded-xl shadow-sm transition flex items-center justify-center gap-2"
                    >
                      <Camera className="w-5 h-5" />عکاسی با دوربین ۳×۴
                    </button>
                    <label htmlFor="personalPhotoFirstUpload" className="mt-2 w-full min-h-11 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 cursor-pointer flex items-center justify-center gap-2">
                      <FolderOpen className="w-4 h-4 text-slate-500" />انتخاب فتو گالری
                    </label>
                  </>
                ) : (
                  <>
                    <label htmlFor="personalPhotoFirstUpload" className="w-full py-3 bg-gradient-to-l from-teal-600 to-teal-500 hover:from-teal-700 text-white text-sm font-extrabold rounded-xl cursor-pointer shadow-sm flex items-center justify-center gap-2">
                      <FolderOpen className="w-5 h-5" />انتخاب فایل ۳×۴ (پیشفرض)
                    </label>
                    <button type="button" onClick={() => alert('سرویس دسکتاپ اسکنر در حال توسعه است. فعلاً از انتخاب فایل استفاده کنید.')}
                      className="mt-2 w-full min-h-11 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 flex items-center justify-center gap-2"
                    >
                      <Camera className="w-4 h-4 text-slate-500" />اسکن مستقیم با دستگاه
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-xs">
              <SectionHeader icon={User} label="اطلاعات شخصی کارآموز" color="sky" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                <Field label="نام" required>
                  <Input icon={User} value={firstName} onChange={setFirstName} placeholder="نام" />
                </Field>
                <Field label="نام خانوادگی" required>
                  <Input icon={User} value={lastName} onChange={setLastName} placeholder="نام خانوادگی" />
                </Field>
                <Field label="کد ملی" required error={nationalCodeError}>
                  <Input icon={CreditCard} value={nationalCode} onChange={setNationalCode} placeholder="کد ملی ده رقمی" mono error={!!nationalCodeError} inputMode="numeric" maxLength={10} autoComplete="off" />
                </Field>
                <Field label="نام پدر">
                  <Input icon={User} value={fatherName} onChange={setFatherName} placeholder="نام پدر" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="تاریخ تولد">
                    <Input icon={Calendar} value={birthDate} onChange={setBirthDate} placeholder="مثال: ۱۳۷۰/۰۵/۲۴" mono />
                  </Field>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 bg-white/80 backdrop-blur border border-slate-200/60 rounded-3xl p-6 shadow-sm space-y-5">
            <SectionHeader icon={Phone} label="اطلاعات ارتباطی" color="teal" />
            <Field label="شماره همراه" required error={phoneError}>
              <Input icon={Phone} value={phoneNumber} onChange={setPhoneNumber} placeholder="شماره موبایل (مانند 09123456789)" mono error={!!phoneError} type="tel" inputMode="numeric" maxLength={11} autoComplete="tel" />
            </Field>
            <Field label="آدرس سکونت">
              <Input icon={MapPin} value={address} onChange={setAddress} placeholder="آدرس کامل پستی" />
            </Field>
          </div>

          <div className="mt-4 space-y-6">
            <div className="bg-white/80 backdrop-blur border border-slate-200/60 rounded-3xl p-6 shadow-sm">
              <SectionHeader icon={BookOpen} label="دوره آموزشی و شماره دوره" color="amber" />
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
                <Field label="تاریخ ثبتنام" required>
                  <Input icon={Calendar} value={signupDate} onChange={setSignupDate} mono />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="دوره آموزشی" required>
                    <div className="relative">
                      <BookOpen className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select value={selectedCourseId} onChange={e => setSelectedCourseId(+e.target.value)}
                        className="w-full min-h-[52px] pr-11 pl-4 text-sm border border-slate-200 rounded-2xl focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 focus:ring-offset-1 transition-all shadow-sm appearance-none bg-white font-medium cursor-pointer">
                        {courses.map(c => (
                          <option key={c.id} value={c.id}>{c.title}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                </div>
                <Field label="شماره دوره">
                  <Input icon={BookOpen} value={courseNumber || ''} onChange={v => { courseNumberTouched.current = true; setCourseNumber(+toLatinDigits(v).replace(/\D/g, '') || 0); }} inputMode="numeric" mono />
                </Field>
              </div>
              <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3.5 mb-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <input type="checkbox" id="hasDiscountTog" checked={hasDiscount} onChange={(e) => setHasDiscount(e.target.checked)} className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer" />
                  <label htmlFor="hasDiscountTog" className="text-sm font-bold text-amber-900 cursor-pointer select-none">اعمال تخفیف روی شهریه</label>
                </div>
                <div className={`grid grid-cols-1 gap-4 ${hasDiscount ? 'sm:grid-cols-2' : ''}`}>
                  {hasDiscount && (
                    <Field label="مبلغ تخفیف (تومان)">
                      <Input icon={DollarSign} value={discountAmount || ''} onChange={v => setDiscountAmount(Math.max(0, +v || 0))} currency mono placeholder="مثال: ۵۰۰٬۰۰۰" />
                    </Field>
                  )}
                  <Field label="شهریه نهایی">
                    <Input icon={DollarSign} value={finalPrice || ''} onChange={() => {}} disabled currency mono />
                  </Field>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-4">
                  <Field label="مبلغ پیش‌پرداخت">
                    <Input icon={DollarSign} value={payAmount || ''} onChange={v => setPayAmount(+v || 0)} currency mono />
                  </Field>
                  <Field label="روش دریافت">
                    <div className="relative">
                      <CreditCard className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                        className="w-full min-h-[52px] pr-11 pl-4 text-sm border border-slate-200 rounded-2xl focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 focus:ring-offset-1 transition-all shadow-sm appearance-none bg-white font-medium cursor-pointer">
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
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs space-y-1.5">
              <div className="font-bold text-slate-600 mb-1">خلاصه پرونده</div>
              <div className="flex justify-between"><span className="text-slate-400">نام</span><span className="font-bold">{firstName} {lastName}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">کد ملی</span><span className="font-mono font-bold">{nationalCode}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">موبایل</span><span className="font-mono font-bold">{phoneNumber}</span></div>
            </div>
          </div>

        <div className="flex flex-col md:flex-row items-center justify-start gap-4 mt-8 pt-6 border-t border-slate-200/80">
          <button type="button" disabled={isSubmitting} onClick={() => void handleSubmit('print')}
            className="flex w-full md:w-auto items-center justify-center gap-2 min-h-[52px] px-8 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 disabled:opacity-50 disabled:grayscale text-white text-sm md:text-base font-black rounded-2xl transition-all shadow-lg shadow-sky-500/30">
            {isSubmitting && submitMode === 'print' ? <><Loader2 className="w-4 h-4 animate-spin" />در حال ثبت...</> : <><FileText className="w-4 h-4" />ثبت و چاپ رسید</>}
          </button>

          <button type="button" disabled={isSubmitting} onClick={() => void handleSubmit('new')}
             className="flex w-full md:w-auto items-center justify-center gap-2 min-h-[52px] px-8 py-3 bg-white border-2 border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 disabled:grayscale text-sm font-black rounded-2xl transition-all shadow-sm">
             {isSubmitting && submitMode === 'new' ? <><Loader2 className="w-4 h-4 animate-spin" />در حال ثبت...</> : <><User className="w-4 h-4" />ثبت و جدید</>}
          </button>
        </div>
      </form>

      {/* ── NEW COURSE NUMBER CONFIRMATION ── */}
      {showNewCoursePrompt && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 w-full max-w-sm space-y-4 text-slate-800 shadow-2xl">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-black text-slate-900 mb-1">شروع دوره جدید؟</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  شماره دوره {courseNumber} از آخرین دوره ثبت‌شده ({currentMax}) بیشتر است.
                  آیا این کارآموز در یک دوره جدید ثبت شود؟
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowNewCoursePrompt(false); setCourseNumber(currentMax); courseNumberTouched.current = false; }}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                ماندن در دوره {currentMax}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit(submitMode, true)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition"
              >
                بله، دوره جدید
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CAMERA MODAL FOR REAL-TIME SCANNING / PHOTO CAPTURE ── */}
      {activeCameraTarget && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-5">
          <div className={`bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 w-full space-y-3 text-slate-800 shadow-2xl ${
            activeCameraTarget === 'idCard' ? 'max-w-4xl' : 'max-w-sm'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-sky-600" />
                {activeCameraTarget === 'idCard' ? 'اسکن افقی کارت ملی (۸۵.۶×۵۴ میلی‌متر)' : 'عکس پرسنلی عمودی ۳×۴ سانتی‌متر'}
              </h3>
              <button
                type="button"
                onClick={stopCamera}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeCameraTarget === 'idCard' && isPortrait && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                <RotateCw className="w-4 h-4 shrink-0" />
                <p className="text-[11px] font-bold leading-relaxed">گوشی را افقی بچرخانید تا کادر با کارت ملی یکی شود.</p>
              </div>
            )}
            {activeCameraTarget === 'personal' && !isPortrait && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                <RotateCw className="w-4 h-4 shrink-0" />
                <p className="text-[11px] font-bold leading-relaxed">گوشی را عمودی بگیرید تا کادر ۳×۴ درست شود.</p>
              </div>
            )}

            <div
              className={`relative overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center ${
                activeCameraTarget === 'idCard'
                  ? 'w-full aspect-[85.6/53.98] rounded-[14px]'
                  : 'w-[220px] mx-auto aspect-[3/4] rounded-xl'
              }`}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {activeCameraTarget === 'personal' && (
                <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-[12%]">
                  <div className="w-[62%] aspect-[3/4] max-h-[58%] rounded-[50%] border-2 border-teal-300/80" />
                </div>
              )}
              <div className="pointer-events-none absolute inset-[6%] rounded-[10px]">
                <span className="absolute top-0 right-0 w-7 h-7 border-t-4 border-r-4 border-sky-400 rounded-tr-md" />
                <span className="absolute top-0 left-0 w-7 h-7 border-t-4 border-l-4 border-sky-400 rounded-tl-md" />
                <span className="absolute bottom-0 right-0 w-7 h-7 border-b-4 border-r-4 border-sky-400 rounded-br-md" />
                <span className="absolute bottom-0 left-0 w-7 h-7 border-b-4 border-l-4 border-sky-400 rounded-bl-md" />
              </div>
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/90 bg-slate-900/70 px-2 py-1 rounded-lg whitespace-nowrap">
                {activeCameraTarget === 'idCard' ? 'کارت را کامل داخل کادر افقی قرار دهید' : 'چهره را داخل عکس پرسنلی قرار دهید'}
              </span>
            </div>

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
                ثبت تصویر کادر
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
