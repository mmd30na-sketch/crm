/**
 * Trainee portal (پرتال کارآموز): installable PWA served at /?portal=1 (manifest + service worker are attached only
 * here, so the staff app is not affected). Login: mobile OTP (/api/trainee-portal/otp/*) or the existing
 * student id + national-code login. Pages: my lessons, debt & installments, online payment (existing Zarinpal flow),
 * enrollment status. Last data is cached for offline viewing; paying needs a connection.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  CalendarClock,
  Wallet,
  CreditCard,
  GraduationCap,
  LogOut,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  getSession,
  saveSession,
  clearSession,
  requestOtp,
  verifyOtp,
  legacyLogin,
  fetchLessons,
  fetchInstallments,
  fetchStatus,
  payOnline,
  toLatin,
  servedFromCache,
  markPortalPaymentReturn,
} from '../api/traineePortal';
import { MISC_STATUS_LABEL, REGISTRATION_STATUS_LABEL } from '../utils/labels';
import { jalaliToGregorian } from '../utils/jalali';

type Session = {
  token: string;
  student_id: string;
  name: string;
  at: number;
};

type Lesson = {
  id: string;
  lesson_date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'done' | 'no_show';
  instructor_name: string;
  vehicle_name: string | null;
};

type Installment = {
  id: string;
  enrollment_id: string;
  seq: number;
  amount: number;
  due_date_jalali: string;
  status: 'unpaid' | 'paid';
  overdue: boolean;
};

type Enrollment = {
  id: string;
  course_title: string;
  course_number: string;
  signup_date_jalali: string;
  final_price: number;
  paid: number;
  remaining: number;
  term_status: 'active' | 'finished' | 'planned';
  term_start: string;
  term_end: string;
};

type Tab = 'lessons' | 'debt' | 'pay' | 'status';

const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

const formatMoney = (amount: number) => `${(Number(amount) || 0).toLocaleString('fa-IR')} تومان`;

const formatPersianDigits = (str: unknown) => String(str ?? '').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d)]);
const digitsOnly = (v: string) => toLatin(v).replace(/\D/g, '');
const studentStatusLabel = (v: string) => MISC_STATUS_LABEL[v] || REGISTRATION_STATUS_LABEL[v] || ({ active: 'فعال', inactive: 'غیرفعال' } as Record<string, string>)[v] || v || '—';

const getWeekday = (jalaliDate: string) => {
  const gregorian = jalaliToGregorian(String(jalaliDate || ''));
  if (!gregorian) return '';
  const date = new Date(Date.UTC(gregorian.gy, gregorian.gm - 1, gregorian.gd));
  return WEEKDAYS[date.getUTCDay()];
};

const StatusBadge = ({ status }: { status: 'scheduled' | 'done' | 'no_show' | 'paid' | 'unpaid' | 'overdue' }) => {
  const statusMap = {
    scheduled: { text: 'برنامه‌ریزی‌شده', color: 'bg-amber-100 text-amber-800' },
    done: { text: 'انجام‌شده', color: 'bg-emerald-100 text-emerald-800' },
    no_show: { text: 'غیبت', color: 'bg-rose-100 text-rose-800' },
    paid: { text: 'پرداخت‌شده', color: 'bg-emerald-100 text-emerald-800' },
    unpaid: { text: 'در انتظار', color: 'bg-amber-100 text-amber-800' },
    overdue: { text: 'سررسید گذشته', color: 'bg-rose-100 text-rose-800' },
  };
  const { text, color } = statusMap[status] || { text: String(status), color: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${color}`}>
      {text}
    </span>
  );
};

const TraineePortal = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('lessons');
  const [mobile, setMobile] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpExpires, setOtpExpires] = useState(0);
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ student_id: string; name: string; token: string }>>([]);
  const [legacyStudentId, setLegacyStudentId] = useState('');
  const [legacyNationalLast4, setLegacyNationalLast4] = useState('');
  const [showLegacyLogin, setShowLegacyLogin] = useState(false);
  const [lessons, setLessons] = useState<{ upcoming: Lesson[]; past: Lesson[] }>({ upcoming: [], past: [] });
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [status, setStatus] = useState<{
    student: { id: string; first_name: string; last_name: string; status: string };
    enrollments: Enrollment[];
  } | null>(null);
  const [selectedEnrollment, setSelectedEnrollment] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<Event | null>(null);
  const [paymentResult, setPaymentResult] = useState<'ok' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smsDelivered, setSmsDelivered] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!otpSent) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [otpSent]);

  useEffect(() => {
    const session = getSession();
    if (session) {
      setSession(session);
      loadData(session.token);
    }

    // Setup PWA
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = '/trainee-manifest.webmanifest';
      document.head.appendChild(manifest);
    }

    if (!document.querySelector('meta[name="theme-color"]')) {
      const themeColor = document.createElement('meta');
      themeColor.name = 'theme-color';
      themeColor.content = '#0284c7';
      document.head.appendChild(themeColor);
    }

    document.title = 'پرتال کارآموز';

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/trainee-sw.js', { scope: '/' }).catch(() => {});
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', () => setShowInstallPrompt(false));

    const handleOnlineStatus = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);

    // Check payment result from URL
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    if (paymentStatus === 'ok' || paymentStatus === 'failed') {
      setPaymentResult(paymentStatus);
      setActiveTab('pay');
      // The gateway callback carries a fresh token (?t=); keep the portal session and drop it from the URL.
      window.history.replaceState({}, document.title, '/?portal=1');
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);

  const loadData = useCallback(async (token: string) => {
    try {
      const [lessonsData, installmentsData, statusData] = await Promise.all([
        fetchLessons(token),
        fetchInstallments(token),
        fetchStatus(token),
      ]);
      setLessons(lessonsData);
      setInstallments(installmentsData.installments || []);
      setStatus(statusData);
      setFromCache(servedFromCache());
      const payable = (statusData.enrollments || []).filter((e) => Number(e.remaining) > 0);
      if (payable.length > 0) {
        setSelectedEnrollment((cur) => (cur && payable.some((e) => String(e.id) === cur) ? cur : String(payable[0].id)));
      }
      setError(null);
    } catch (err) {
      if ((err as any).status === 401) {
        clearSession();
        setSession(null);
        setError('نشست منقضی شده است؛ دوباره وارد شوید.');
      } else {
        setError((err as Error).message);
      }
    }
  }, []);

  const handleInstallClick = () => {
    if (installPromptEvent) {
      (installPromptEvent as any).prompt();
      (installPromptEvent as any).userChoice.then((choice: { outcome: string }) => {
        if (choice.outcome === 'accepted') {
          setShowInstallPrompt(false);
        }
      });
    }
  };

  const handleOtpRequest = async () => {
    if (!/^09\d{9}$/.test(digitsOnly(mobile))) { setError('شماره موبایل را به شکل ۰۹xxxxxxxxx وارد کنید.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const response = await requestOtp(digitsOnly(mobile));
      setOtpSent(true);
      setSmsDelivered(!!response.sent);
      setOtpCode('');
      setOtpExpires(Date.now() + response.expires_in * 1000);
      if (response.dev_code) {
        setDevCode(response.dev_code);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleOtpVerify = async () => {
    if (!mobile || digitsOnly(otpCode).length !== 5) { setError('کد ۵ رقمی را وارد کنید.'); return; }
    try {
      const response = await verifyOtp(digitsOnly(mobile), digitsOnly(otpCode));
      if (!response.accounts?.length) { setError('کد تأیید نادرست یا منقضی است.'); return; }
      if (response.accounts.length > 1) {
        setAccounts(response.accounts);
      } else {
        const account = response.accounts[0];
        const session: Session = {
          token: account.token,
          student_id: String(account.student_id),
          name: account.name,
          at: Date.now(),
        };
        saveSession(session);
        setSession(session);
        loadData(account.token);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAccountSelect = (account: { student_id: string; name: string; token: string }) => {
    const session: Session = {
      token: account.token,
      student_id: String(account.student_id),
      name: account.name,
      at: Date.now(),
    };
    saveSession(session);
    setSession(session);
    loadData(account.token);
    setAccounts([]);
  };

  const handleLegacyLogin = async () => {
    if (!legacyStudentId || !legacyNationalLast4) return;
    try {
      const response = await legacyLogin(legacyStudentId, legacyNationalLast4);
      const session: Session = {
        token: response.token,
        student_id: String(response.student.id),
        name: `${response.student.first_name} ${response.student.last_name}`,
        at: Date.now(),
      };
      saveSession(session);
      setSession(session);
      loadData(response.token);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setStatus(null);
    setLessons({ upcoming: [], past: [] });
    setInstallments([]);
    setOtpSent(false);
    setOtpCode('');
  };

  const handlePayOnline = async () => {
    if (!session || !selectedEnrollment || busy) return;
    const amount = Number(digitsOnly(paymentAmount)) || getNextInstallmentAmount(selectedEnrollment);
    if (!amount || amount <= 0) { setError('مبلغ پرداخت را وارد کنید.'); return; }
    if (amount > getEnrollmentRemaining(selectedEnrollment)) { setError('مبلغ از مانده این دوره بیشتر است.'); return; }
    setBusy(true);
    try {
      const response = await payOnline(session.token, selectedEnrollment, amount);
      markPortalPaymentReturn();
      window.location.href = response.payment_url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const getTotalRemaining = () => {
    if (!status) return 0;
    return status.enrollments.reduce((sum, enrollment) => sum + (Number(enrollment.remaining) || 0), 0);
  };

  const getEnrollmentRemaining = (enrollmentId: string) => {
    if (!status) return 0;
    const enrollment = status.enrollments.find(e => String(e.id) === String(enrollmentId));
    return enrollment ? Number(enrollment.remaining) || 0 : 0;
  };

  const getNextInstallmentAmount = (enrollmentId: string) => {
    const enrollmentInstallments = installments.filter(
      i => String(i.enrollment_id) === String(enrollmentId) && i.status === 'unpaid'
    );
    const remaining = getEnrollmentRemaining(enrollmentId);
    if (enrollmentInstallments.length === 0) return remaining;
    return Math.min(Number(enrollmentInstallments[0].amount) || 0, remaining) || remaining;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = digitsOnly(e.target.value).slice(0, 12);
    if (value === '') {
      setPaymentAmount('');
      return;
    }
    setPaymentAmount(Number(value).toLocaleString('fa-IR'));
  };

  const renderLoginScreen = () => (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-2xl font-bold text-center mb-6">ورود به پرتال کارآموز</h1>

      {error && (
        <div role="alert" className="bg-rose-100 text-rose-800 p-3 rounded-xl mb-4">
          {error}
        </div>
      )}

      {accounts.length > 0 ? (
        <div>
          <p className="mb-4">چندین حساب برای این شماره یافت شد. لطفاً حساب مورد نظر را انتخاب کنید:</p>
          <div className="space-y-3">
            {accounts.map(account => (
              <button
                key={account.student_id}
                onClick={() => handleAccountSelect(account)}
                className="w-full bg-white border border-slate-200 rounded-xl p-4 text-right hover:bg-slate-50 transition-colors"
              >
                <div className="font-medium">{account.name}</div>
                <div className="text-sm text-slate-500">شناسه: {account.student_id}</div>
              </button>
            ))}
          </div>
        </div>
      ) : showLegacyLogin ? (
        <div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-4">
            <h2 className="text-lg font-bold mb-4">ورود با شناسه کارآموز</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">شناسه کارآموز</label>
                <input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  value={legacyStudentId}
                  onChange={(e) => setLegacyStudentId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">چهار رقم آخر کد ملی</label>
                <input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={4}
                  value={legacyNationalLast4}
                  onChange={(e) => setLegacyNationalLast4(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </div>
              <button
                onClick={handleLegacyLogin}
                className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold py-3 transition-colors"
              >
                ورود
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowLegacyLogin(false)}
            className="text-sky-600 hover:text-sky-700 text-sm font-medium"
          >
            بازگشت به ورود با شماره موبایل
          </button>
        </div>
      ) : (
        <div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-4">
            <h2 className="text-lg font-bold mb-4">ورود با شماره موبایل</h2>
            {!otpSent ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">شماره موبایل</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="09xxxxxxxxx"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <button
                  onClick={handleOtpRequest}
                  disabled={busy || isOffline}
                  className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-xl font-bold py-3 transition-colors"
                >
                  دریافت کد تأیید
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">کد تأیید</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    dir="ltr"
                    maxLength={5}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                  {devCode && (
                    <div className="mt-2 text-sm text-slate-500">
                      کد توسعه: <span className="font-mono">{devCode}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleOtpVerify}
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold py-3 transition-colors"
                >
                  ورود
                </button>
                {Date.now() < otpExpires ? (
                  <div className="text-center text-sm text-slate-500">
                    اعتبار کد: {formatPersianDigits(Math.max(0, Math.ceil((otpExpires - Date.now()) / 1000)))} ثانیه
                  </div>
                ) : (
                  <button
                    onClick={handleOtpRequest}
                    className="w-full text-sky-600 hover:text-sky-700 text-sm font-medium"
                  >
                    ارسال دوباره
                  </button>
                )}
                <button
                  onClick={() => { setOtpSent(false); setOtpCode(''); setDevCode(null); }}
                  className="w-full text-sky-600 hover:text-sky-700 text-sm font-medium"
                >
                  تغییر شماره
                </button>
              </div>
            )}
          </div>
          {!otpSent && (
            <button
              onClick={() => setShowLegacyLogin(true)}
              className="text-sky-600 hover:text-sky-700 text-sm font-medium"
            >
              ورود با شناسه کارآموز و کد ملی
            </button>
          )}
        </div>
      )}

      {otpSent && !smsDelivered && !accounts.length && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-sm">
          اگر این شماره در آموزشگاه ثبت شده باشد، کد برایتان پیامک می‌شود. در صورت دریافت نکردن، از ورود با شناسه کارآموز استفاده کنید.
        </div>
      )}
    </div>
  );

  const renderAppBar = () => (
    <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
      <div className="max-w-lg mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <button onClick={handleLogout} aria-label="خروج" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100">
            <LogOut size={20} />
          </button>
        </div>
        <div className="text-lg font-bold">پرتال کارآموز</div>
        <div className="text-sm font-medium">{session?.name}</div>
      </div>
    </div>
  );

  const renderTabBar = () => (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-lg mx-auto flex justify-around p-2">
        <button
          onClick={() => setActiveTab('lessons')}
          className={`flex flex-col items-center p-2 ${activeTab === 'lessons' ? 'text-sky-600' : 'text-slate-500'}`}
        >
          <CalendarClock size={24} />
          <span className="text-xs mt-1">جلسات من</span>
        </button>
        <button
          onClick={() => setActiveTab('debt')}
          className={`flex flex-col items-center p-2 ${activeTab === 'debt' ? 'text-sky-600' : 'text-slate-500'}`}
        >
          <Wallet size={24} />
          <span className="text-xs mt-1">بدهی و اقساط</span>
        </button>
        <button
          onClick={() => setActiveTab('pay')}
          className={`flex flex-col items-center p-2 ${activeTab === 'pay' ? 'text-sky-600' : 'text-slate-500'}`}
        >
          <CreditCard size={24} />
          <span className="text-xs mt-1">پرداخت</span>
        </button>
        <button
          onClick={() => setActiveTab('status')}
          className={`flex flex-col items-center p-2 ${activeTab === 'status' ? 'text-sky-600' : 'text-slate-500'}`}
        >
          <GraduationCap size={24} />
          <span className="text-xs mt-1">وضعیت ثبت‌نام</span>
        </button>
      </div>
    </div>
  );

  const renderLessonsTab = () => (
    <div className="max-w-lg mx-auto p-4 pb-24">
      {lessons.upcoming.length === 0 && lessons.past.length === 0 ? (
        <div className="text-center text-slate-500 py-8">
          هنوز جلسه‌ای برای شما رزرو نشده است.
        </div>
      ) : (
        <div className="space-y-4">
          {lessons.upcoming.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">جلسات آتی</h2>
              <div className="space-y-3">
                {lessons.upcoming.map((lesson, index) => (
                  <div
                    key={lesson.id}
                    className={`bg-white border border-slate-200 rounded-2xl p-4 shadow-sm ${index === 0 ? 'ring-2 ring-sky-200' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm text-slate-500">{getWeekday(lesson.lesson_date)}</div>
                        <div className="text-lg font-medium">{formatPersianDigits(lesson.lesson_date)}</div>
                        <div className="text-sm">
                          <span dir="ltr">{formatPersianDigits(lesson.start_time)} – {formatPersianDigits(lesson.end_time)}</span>
                        </div>
                      </div>
                      <StatusBadge status={lesson.status} />
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <div className="text-sm">
                        <span className="font-medium">مربی:</span> {lesson.instructor_name}
                      </div>
                      {lesson.vehicle_name && (
                        <div className="text-sm mt-1">
                          <span className="font-medium">وسیله:</span> {lesson.vehicle_name}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lessons.past.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">جلسات گذشته</h2>
              <div className="space-y-3">
                {lessons.past.map(lesson => (
                  <div key={lesson.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm text-slate-500">{getWeekday(lesson.lesson_date)}</div>
                        <div className="text-lg font-medium">{formatPersianDigits(lesson.lesson_date)}</div>
                        <div className="text-sm">
                          <span dir="ltr">{formatPersianDigits(lesson.start_time)} – {formatPersianDigits(lesson.end_time)}</span>
                        </div>
                      </div>
                      <StatusBadge status={lesson.status} />
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <div className="text-sm">
                        <span className="font-medium">مربی:</span> {lesson.instructor_name}
                      </div>
                      {lesson.vehicle_name && (
                        <div className="text-sm mt-1">
                          <span className="font-medium">وسیله:</span> {lesson.vehicle_name}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderDebtTab = () => (
    <div className="max-w-lg mx-auto p-4 pb-24">
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <h2 className="text-lg font-bold mb-2">مجموع بدهی</h2>
          <div className="text-2xl font-bold text-rose-600">{formatMoney(getTotalRemaining())}</div>
        </div>

        {status?.enrollments.map(enrollment => (
          <div key={enrollment.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-bold">{enrollment.course_title}</h3>
                {enrollment.course_number ? <div className="text-sm text-slate-500">شماره دوره: {formatPersianDigits(enrollment.course_number)}</div> : null}
              </div>
              <div className="text-sm text-rose-600 font-medium">
                {formatMoney(enrollment.remaining)}
              </div>
            </div>

            <div className="space-y-2">
              {installments
                .filter(i => String(i.enrollment_id) === String(enrollment.id))
                .map(installment => (
                  <div key={installment.id} className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                    <div>
                      <div className="text-sm">قسط {formatPersianDigits(installment.seq)}</div>
                      <div className="text-xs text-slate-500">{formatPersianDigits(installment.due_date_jalali)}</div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="text-sm font-medium">{formatMoney(installment.amount)}</div>
                      <StatusBadge status={installment.status === 'unpaid' && installment.overdue ? 'overdue' : installment.status} />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPayTab = () => {
    const totalRemaining = getTotalRemaining();
    const hasPayable = totalRemaining > 0;

    return (
      <div className="max-w-lg mx-auto p-4 pb-24">
        {paymentResult && (
          <div className={`p-3 rounded-xl mb-4 ${paymentResult === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
            {paymentResult === 'ok' ? (
              <div className="flex items-center">
                <CheckCircle2 size={20} className="ml-2" />
                پرداخت با موفقیت انجام شد.
              </div>
            ) : (
              <div className="flex items-center">
                <XCircle size={20} className="ml-2" />
                پرداخت ناموفق بود. لطفاً دوباره تلاش کنید.
              </div>
            )}
          </div>
        )}

        {hasPayable ? (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <h2 className="text-lg font-bold mb-4">پرداخت آنلاین</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">دوره</label>
                <select
                  value={selectedEnrollment}
                  onChange={(e) => { setSelectedEnrollment(e.target.value); setPaymentAmount(''); }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                >
                  {status?.enrollments.filter(e => Number(e.remaining) > 0).map(enrollment => (
                    <option key={enrollment.id} value={String(enrollment.id)}>
                      {enrollment.course_title} - {formatMoney(enrollment.remaining)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">مبلغ (تومان)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  value={paymentAmount}
                  onChange={handleAmountChange}
                  placeholder={formatMoney(getNextInstallmentAmount(selectedEnrollment))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <button
                onClick={handlePayOnline}
                disabled={isOffline || busy}
                className={`w-full rounded-xl font-bold py-3 transition-colors ${isOffline ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-sky-600 hover:bg-sky-700 text-white'}`}
              >
                پرداخت آنلاین با زرین‌پال
              </button>

              <div className="mt-3 text-sm text-slate-500">
                پرداخت از طریق درگاه امن زرین‌پال انجام می‌شود.
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-slate-500 py-8">
            بدهی‌ای برای پرداخت ندارید.
          </div>
        )}
      </div>
    );
  };

  const renderStatusTab = () => (
    <div className="max-w-lg mx-auto p-4 pb-24">
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <h2 className="text-lg font-bold mb-2">وضعیت کارآموز</h2>
          <div className="text-sm">
            <span className="font-medium">نام:</span> {status?.student.first_name} {status?.student.last_name}
          </div>
          <div className="text-sm mt-1">
            <span className="font-medium">شناسه:</span> {formatPersianDigits(status?.student.id)}
          </div>
          <div className="text-sm mt-1">
            <span className="font-medium">وضعیت:</span> {studentStatusLabel(String(status?.student.status || ''))}
          </div>
        </div>

        {status?.enrollments.map(enrollment => (
          <div key={enrollment.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold mb-2">{enrollment.course_title}</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">شماره دوره:</span> {enrollment.course_number ? formatPersianDigits(enrollment.course_number) : '—'}
              </div>
              <div>
                <span className="font-medium">تاریخ ثبت‌نام:</span> {formatPersianDigits(enrollment.signup_date_jalali)}
              </div>
              <div>
                <span className="font-medium">وضعیت دوره:</span> {
                  enrollment.term_status === 'active' ? 'در حال برگزاری' :
                  enrollment.term_status === 'finished' ? 'پایان‌یافته' :
                  enrollment.term_status === 'planned' ? 'برنامه‌ریزی‌شده' : '—'
                }
              </div>
              {(enrollment.term_start || enrollment.term_end) && (
                <div>
                  <span className="font-medium">تاریخ دوره:</span> {formatPersianDigits(enrollment.term_start || '—')} تا {formatPersianDigits(enrollment.term_end || '—')}
                </div>
              )}
              <div className="mt-2 pt-2 border-t border-slate-100">
                <div>
                  <span className="font-medium">مبلغ کل:</span> {formatMoney(enrollment.final_price)}
                </div>
                <div>
                  <span className="font-medium">پرداخت شده:</span> {formatMoney(enrollment.paid)}
                </div>
                <div>
                  <span className="font-medium">باقیمانده:</span> <span className="text-rose-600">{formatMoney(enrollment.remaining)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-800">
      {(isOffline || (session && fromCache)) && (
        <div className="bg-amber-100 text-amber-800 p-2 text-center text-sm">
          <div className="flex items-center justify-center">
            <AlertCircle size={16} className="ml-1" />
            شما آفلاین هستید؛ آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود.
          </div>
        </div>
      )}

      {showInstallPrompt && (
        <div className="bg-sky-100 text-sky-800 p-2 text-center text-sm">
          <button
            onClick={handleInstallClick}
            className="flex items-center justify-center w-full"
          >
            <Download size={16} className="ml-1" />
            نصب برنامه
          </button>
        </div>
      )}

      {!session ? (
        renderLoginScreen()
      ) : (
        <>
          {renderAppBar()}
          {error && <div role="alert" className="max-w-lg mx-auto mt-3 bg-rose-100 text-rose-800 p-3 rounded-xl text-sm">{error}</div>}
          {activeTab === 'lessons' && renderLessonsTab()}
          {activeTab === 'debt' && renderDebtTab()}
          {activeTab === 'pay' && renderPayTab()}
          {activeTab === 'status' && renderStatusTab()}
          {renderTabBar()}
        </>
      )}
    </div>
  );
};

export default TraineePortal;
