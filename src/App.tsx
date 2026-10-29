import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  BarChart3,
  Settings as SettingsIcon,
  Calendar,
  Menu,
  LayoutDashboard,
  MessageSquare,
  RefreshCw,
  LogOut,
  Contact,
  AtSign,
  ClipboardList,
  Megaphone,
  CalendarRange,
  Bot,
  History,
  BellRing,
  Wallet,
} from 'lucide-react';
import { Student, Course, Enrollment, Payment, Expense, StaffRole } from './types';
import * as api from './api/client';
import StudentList from './components/StudentList';
import StudentRegistrationForm from './components/StudentRegistrationForm';
import AccountingDashboard from './components/AccountingDashboard';
import Settings from './components/Settings';
import ContractPrintForm from './components/forms/ContractPrintForm';
import PrintPreview from './components/print/PrintPreview';
import SupervisorDashboard from './components/SupervisorDashboard';
import PendingRegistrationsPanel from './components/PendingRegistrationsPanel';
import MessengerHub from './components/MessengerHub';
import LoginScreen from './components/LoginScreen';
import { CopilotProvider, CopilotBar, CopilotPage } from './components/CopilotWidget';
import LeadsPanel from './components/LeadsPanel';
import EmailPanel from './components/EmailPanel';
import TasksPanel from './components/TasksPanel';
import BulkMessaging from './components/BulkMessaging';
import CourseTermsPanel from './components/CourseTermsPanel';
import SiteRequestsHistory from './components/SiteRequestsHistory';
import InstructorPayPanel from './components/InstructorPayPanel';
import OnlinePaymentsReview from './components/OnlinePaymentsReview';
import DebtSmsPanel from './components/DebtSmsPanel';
import TraineePaymentsPanel from './components/TraineePaymentsPanel';
import { taskSummary } from './api/phase4';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

const NAV_ITEMS = [
  {
    id: 'supervisor',
    label: 'داشبورد نظارت',
    sublabel: 'کنترل و نمای کلی',
    icon: LayoutDashboard,
    color: 'brand',
    roles: ['admin'] as StaffRole[],
  },
  {
    id: 'students',
    label: 'هنرجویان',
    sublabel: 'مدیریت هنرجویان',
    icon: Users,
    color: 'teal',
    roles: ['admin', 'cashier', 'instructor'] as StaffRole[],
  },
  {
    id: 'terms',
    label: 'مدیریت دوره‌ها',
    sublabel: 'شماره دوره، ظرفیت و وضعیت',
    icon: CalendarRange,
    color: 'teal',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'register',
    label: 'ثبت‌نام هوشمند',
    sublabel: 'OCR کارت ملی',
    icon: UserPlus,
    color: 'purple',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'accounting',
    label: 'حسابداری مالی',
    sublabel: 'درآمد و مخارج',
    icon: BarChart3,
    color: 'amber',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'copilot',
    label: 'دستیار هوشمند',
    sublabel: 'همان گفتگوی داشبورد',
    icon: Bot,
    color: 'brand',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'pay',
    label: 'حق‌التدریس',
    sublabel: 'مربیان و تسویه ماهانه',
    icon: Wallet,
    color: 'amber',
    roles: ['admin'] as StaffRole[],
  },
  {
    id: 'online-payments',
    label: 'پرداخت‌های آنلاین',
    sublabel: 'تأیید اقساط و رسید',
    icon: Wallet,
    color: 'emerald',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'debt-sms',
    label: 'ارسال به بدهکاران',
    sublabel: 'پیامک بدهی و لینک پرداخت',
    icon: BellRing,
    color: 'rose',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'messenger',
    label: 'پیام‌رسان',
    sublabel: 'مرکز ارتباطی',
    icon: MessageSquare,
    color: 'rose',
    // The server allows /api/messenger for admin and cashier only.
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'leads',
    label: 'سرنخ‌ها',
    sublabel: 'تماس‌گیرندگان و پیگیری',
    icon: Contact,
    color: 'teal',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'email',
    label: 'ایمیل',
    sublabel: 'رسید، گواهی، یادآوری و کمپین',
    icon: AtSign,
    color: 'rose',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'site-requests',
    label: 'تاریخچه درخواست‌های سایت',
    sublabel: 'همه ثبت‌نام‌های آنلاین',
    icon: History,
    color: 'purple',
    roles: ['admin', 'cashier'] as StaffRole[],
  },
  {
    id: 'tasks',
    label: 'کارها',
    sublabel: 'ارجاع و مهلت',
    icon: ClipboardList,
    color: 'brand',
    roles: ['admin', 'cashier', 'instructor'] as StaffRole[],
  },
  {
    id: 'campaigns',
    label: 'پیام انبوه',
    sublabel: 'کمپین روبیکا',
    icon: Megaphone,
    color: 'rose',
    roles: ['admin'] as StaffRole[],
  },
  {
    id: 'settings',
    label: 'تنظیمات آموزشگاه',
    sublabel: 'پیکربندی سیستم',
    icon: SettingsIcon,
    color: 'slate',
    roles: ['admin'] as StaffRole[],
  },
];

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: 'مدیر سیستم',
  cashier: 'صندوقدار',
  instructor: 'مربی',
};

const ICON_COLOR_MAP: Record<string, string> = {
  brand:  'text-sky-400',
  teal:   'text-teal-400',
  purple: 'text-violet-400',
  amber:  'text-amber-400',
  rose:   'text-rose-400',
  emerald: 'text-emerald-400',
  slate:  'text-slate-400',
};

const ACTIVE_BADGE_MAP: Record<string, string> = {
  brand:  'bg-sky-500/20 text-sky-300',
  teal:   'bg-teal-500/20 text-teal-300',
  purple: 'bg-violet-500/20 text-violet-300',
  amber:  'bg-amber-500/20 text-amber-300',
  rose:   'bg-rose-500/20 text-rose-300',
  emerald: 'bg-emerald-500/20 text-emerald-300',
  slate:  'bg-slate-500/20 text-slate-300',
};

/**
 * Trainee payment panel is served from the same URL with ?trainee=1&t=<signed token>; it uses a signed
 * trainee token, not a staff session, so it renders outside the staff shell.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('trainee') === '1') {
    return (
      <ThemeProvider>
        <TraineePaymentsPanel token={params.get('t') || ''} code={params.get('code') || ''} />
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

function AppShell() {
  const { theme } = useTheme();
  const [authed, setAuthed] = useState<boolean>(!!api.getAuthToken());
  const [authChecking, setAuthChecking] = useState<boolean>(!!api.getAuthToken());
  const [currentUser, setCurrentUser] = useState<{ username: string; role?: StaffRole; full_name?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('supervisor');
  const [taskCounts, setTaskCounts] = useState<{ open: number; overdue: number }>({ open: 0, overdue: 0 });
  const refreshTaskCounts = () => { taskSummary().then(setTaskCounts).catch(() => undefined); };
  useEffect(() => {
    if (!currentUser) return;
    refreshTaskCounts();
    const t = setInterval(refreshTaskCounts, 120000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);
  const [loading, setLoading] = useState<boolean>(true);
  // On phones the sidebar overlays the content, so start collapsed there.
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => window.innerWidth >= 1024);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const refreshAllData = async () => {
    setIsRefreshing(true);
    try {
      // Photo/receipt URLs are built with the file token, so get one before the lists are loaded.
      await api.ensureFileToken();
      // Each dataset is loaded on its own: a role that may not read payments/expenses (e.g. the instructor)
      // must still get students and courses, and a failed refresh keeps what is already on screen.
      const results = await Promise.allSettled([
        api.fetchStudents(),
        api.fetchCourses(),
        api.fetchEnrollments(),
        api.fetchPayments(),
        api.fetchExpenses(),
      ]);
      const apply = <T,>(r: PromiseSettledResult<T>, set: React.Dispatch<React.SetStateAction<T>>) => {
        if (r.status === 'fulfilled') set(r.value);
      };
      apply(results[0] as PromiseSettledResult<Student[]>, setStudents);
      apply(results[1] as PromiseSettledResult<Course[]>, setCourses);
      apply(results[2] as PromiseSettledResult<Enrollment[]>, setEnrollments);
      apply(results[3] as PromiseSettledResult<Payment[]>, setPayments);
      apply(results[4] as PromiseSettledResult<Expense[]>, setExpenses);
      results.forEach((r, i) => {
        if (r.status === 'rejected' && !/403|Forbidden/i.test(String(r.reason))) console.error('Error fetching dataset', i, r.reason);
      });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const onLost = () => setAuthed(false);
    window.addEventListener('carla-auth-lost', onLost);
    return () => window.removeEventListener('carla-auth-lost', onLost);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = new URL(window.location.href);
        const ssoTicket = u.searchParams.get('sso_ticket');
        if (ssoTicket) {
          u.searchParams.delete('sso_ticket');
          window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
          setAuthChecking(true);
          await api.ssoExchange(ssoTicket);
        }
      } catch {}
      if (!api.getAuthToken()) {
        setAuthChecking(false);
        setAuthed(false);
        return;
      }
      try {
        const me = await api.fetchMe();
        if (!cancelled) {
          setCurrentUser(me.user || null);
          setAuthed(true);
        }
      } catch {
        api.logout();
        if (!cancelled) {
          setCurrentUser(null);
          setAuthed(false);
        }
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authed) return;
    api.startFileTokenRefresh();
    refreshAllData();
  }, [authed]);

  // A renewed file token goes into the photo/receipt URLs already on screen (images re-render with it).
  useEffect(() => {
    const onFileToken = () => {
      setStudents(prev => prev.map(api.withCurrentFileToken));
      setEnrollments(prev => prev.map(e => (e.receipt_pdf_path ? { ...e, receipt_pdf_path: api.protectedFileUrl(e.receipt_pdf_path) } : e)));
    };
    window.addEventListener(api.FILE_TOKEN_EVENT, onFileToken);
    return () => window.removeEventListener(api.FILE_TOKEN_EVENT, onFileToken);
  }, []);

  const role: StaffRole = currentUser?.role === 'cashier' || currentUser?.role === 'instructor' ? currentUser.role : 'admin';
  const visibleNav = NAV_ITEMS.filter(item => item.roles.includes(role));

  const handleActiveTabChange = (newTab: string) => {
    if (!visibleNav.some(item => item.id === newTab)) return;
    setActiveTab(newTab);
    // On phones the sidebar covers the content: close it once a tab is picked.
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  useEffect(() => {
    if (!visibleNav.some(item => item.id === activeTab)) {
      setActiveTab(visibleNav[0]?.id || 'students');
    }
  }, [role, activeTab]);

  const activeNavItem = visibleNav.find(n => n.id === activeTab) || NAV_ITEMS.find(n => n.id === activeTab);

  const jalaliDate = new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' });

  if (authChecking) {
    return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center" dir="rtl">در حال بررسی ورود...</div>;
  }
  if (!authed) {
    return <LoginScreen onLoggedIn={(user) => { setCurrentUser(user || null); setAuthed(true); }} />;
  }

  return (
    <CopilotProvider onOpenTab={() => handleActiveTabChange('copilot')} isAdmin={role === 'admin'}>
    <div
      className="flex h-screen supports-[height:100dvh]:h-[100dvh] w-screen max-w-full overflow-hidden text-slate-900"
      style={{ background: 'var(--app-bg)' }}
      dir="rtl"
      id="app-root"
    >
      {/* ═══════════════════════════════════════════════
          SIDEBAR — Dark Premium Navigation
      ═══════════════════════════════════════════════ */}
      {/* Phones: the sidebar is an overlay above the content; tapping the backdrop closes it. */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setIsSidebarOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={`carla-sidebar flex flex-col shrink-0 transition-all duration-300 ease-in-out fixed inset-y-0 right-0 z-40 lg:static lg:z-auto ${
          isSidebarOpen ? 'w-64 opacity-100' : 'w-0 opacity-0 pointer-events-none overflow-hidden invisible'
        }`}
        id="app-sidebar"
      >
        {/* Brand Header */}
        <div className="p-5 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="carla-brand-logo overflow-hidden">
              {theme?.logo_url ? (
                <img src={theme.logo_url} alt="لوگوی آموزشگاه" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-black text-base leading-none">C</span>
              )}
            </div>
            <div>
              <h1 className="text-white text-base font-bold tracking-tight leading-tight">سامانه CRM</h1>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-white/5" />

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p className="carla-section-title px-3 mb-2">منوی اصلی</p>

          {visibleNav.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                onClick={() => handleActiveTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 text-right group ${
                  isActive
                    ? 'text-white shadow-lg'
                    : 'text-slate-400 hover:text-white hover:bg-white/6'
                }`}
                style={isActive ? {
                  background: 'linear-gradient(to left, var(--brand-primary-dark), var(--brand-primary))',
                  boxShadow: '0 10px 15px -3px rgba(var(--brand-primary-rgb), 0.45)',
                } : undefined}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                  isActive ? 'bg-white/20' : `bg-white/5 group-hover:bg-white/10`
                }`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 text-right min-w-0">
                  <div className={`text-sm font-semibold leading-tight truncate ${isActive ? 'text-white' : ''}`}>
                    {item.label}
                  </div>
                  <div className={`text-[10px] leading-tight truncate transition-all ${
                    isActive ? 'text-white/70' : 'text-slate-400 group-hover:text-slate-300'
                  }`}>
                    {item.sublabel}
                  </div>
                </div>
                {item.id === 'tasks' && taskCounts.open > 0 && (
                  <span title={taskCounts.overdue ? `${taskCounts.overdue} کار عقب‌افتاده` : 'کارهای باز'}
                    className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0 ${taskCounts.overdue ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/15 text-white'}`}>
                    {(taskCounts.overdue || taskCounts.open).toLocaleString('fa-IR')}
                  </span>
                )}
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)] shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-white/5">
          {/* User Card */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/5">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-300 leading-tight truncate">{currentUser?.full_name || currentUser?.username || 'کاربر'}</div>
              <div className="text-[10px] text-slate-400 leading-tight">{ROLE_LABEL[role]}</div>
            </div>
            <button
              title="خروج"
              onClick={() => { api.logout(); setCurrentUser(null); setAuthed(false); }}
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════
          MAIN CONTENT
      ═══════════════════════════════════════════════ */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden" id="main-view-wrapper">

        {/* ── HEADER ── */}
        <header
          className="carla-header h-16 px-3 sm:px-6 gap-2 flex items-center justify-between shrink-0"
          id="main-header"
        >
          {/* Left: Sidebar Toggle + Breadcrumb */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-label="منو"
              aria-expanded={isSidebarOpen}
              className="p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all"
              title={isSidebarOpen ? 'بستن منو' : 'باز کردن منو'}
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              {activeNavItem && (
                <div className="flex items-center gap-1.5">
                  <activeNavItem.icon className={`h-4 w-4 ${ICON_COLOR_MAP[activeNavItem.color]}`} />
                  <span className="min-w-0 truncate font-semibold text-slate-700">{activeNavItem.label}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-2">
            {/* Refresh */}
            <button
              onClick={refreshAllData}
              aria-label="بارگذاری مجدد"
              className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all ${isRefreshing ? 'animate-spin text-sky-500' : ''}`}
              title="بارگذاری مجدد"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            {/* Separator (only when the date is visible) */}
            <div className="hidden lg:block h-6 w-px bg-slate-200" />

            {/* Date */}
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-1.5">
              <Calendar className="h-3.5 w-3.5 text-sky-400" />
              <span className="font-bold font-mono text-[11px] text-slate-600">{jalaliDate}</span>
            </div>

            {/* Separator (only when the user name is visible) */}
            <div className="hidden md:block h-6 w-px bg-slate-200" />

            {/* User Avatar */}
            <div className="flex items-center gap-2.5 pl-1">
              <div className="hidden md:block text-right">
                <div className="text-xs font-bold text-slate-700 leading-tight">{currentUser?.full_name || currentUser?.username || 'کاربر'}</div>
                <div className="text-[10px] text-slate-400">{ROLE_LABEL[role]}</div>
              </div>
            </div>
          </div>
        </header>

        {/* ── CONTENT AREA ── */}
        <div
          className={`flex-1 overflow-x-hidden p-3 sm:p-6 ${
            activeTab === 'copilot' ? 'flex min-h-0 flex-col overflow-hidden' : 'space-y-5 overflow-y-auto'
          }`}
          id="main-content-scroll"
        >
          {new URLSearchParams(window.location.search).get('print') === 'contract' ? (
              <ContractPrintForm
                enrollmentId={Number(new URLSearchParams(window.location.search).get('enrollment')) || undefined}
              />
          ) : new URLSearchParams(window.location.search).get('print') === 'all' ? (
              <PrintPreview enrollmentId={Number(new URLSearchParams(window.location.search).get('enrollment')) || undefined} />
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-40 space-y-4 fade-in">
              <div className="carla-spinner" />
              <p className="text-sm text-slate-400 font-medium">در حال بارگذاری داده‌ها...</p>
            </div>
          ) : (
            <div className={activeTab === 'copilot' ? 'fade-in flex h-full min-h-0 flex-col' : 'fade-in'}>
              {activeTab === 'copilot' && (role === 'admin' || role === 'cashier') && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <CopilotPage />
                </div>
              )}
              {activeTab === 'supervisor' && role === 'admin' && (
                <div className="space-y-5">
                  <CopilotBar />
                  <PendingRegistrationsPanel onActiveTabChange={handleActiveTabChange} courses={courses} />
                  <SupervisorDashboard
                    students={students}
                    courses={courses}
                    enrollments={enrollments}
                    payments={payments}
                    onRefresh={refreshAllData}
                    onActiveTabChange={handleActiveTabChange}
                    isSidebarOpen={isSidebarOpen}
                  />
                </div>
              )}
              {activeTab === 'students' && (
                <StudentList
                  students={students}
                  courses={courses}
                  enrollments={enrollments}
                  payments={payments}
                  onRefresh={refreshAllData}
                  onActiveTabChange={handleActiveTabChange}
                  role={role}
                />
              )}
              {activeTab === 'register' && (role === 'admin' || role === 'cashier') && (
                <StudentRegistrationForm
                  courses={courses}
                  enrollments={enrollments}
                  onRefresh={refreshAllData}
                  onActiveTabChange={handleActiveTabChange}
                />
              )}
              {activeTab === 'accounting' && (role === 'admin' || role === 'cashier') && (
                <AccountingDashboard
                  students={students}
                  courses={courses}
                  enrollments={enrollments}
                  payments={payments}
                  expenses={expenses}
                  onRefresh={refreshAllData}
                />
              )}
              {activeTab === 'messenger' && (role === 'admin' || role === 'cashier') && (
                <MessengerHub
                  students={students}
                  courses={courses}
                  enrollments={enrollments}
                  payments={payments}
                  onRefresh={refreshAllData}
                />
              )}
              {activeTab === 'terms' && (role === 'admin' || role === 'cashier') && (
                <CourseTermsPanel courses={courses} isAdmin={role === 'admin'} />
              )}
              {activeTab === 'pay' && role === 'admin' && (
                <InstructorPayPanel />
              )}
              {activeTab === 'online-payments' && (role === 'admin' || role === 'cashier') && (
                <OnlinePaymentsReview />
              )}
              {activeTab === 'debt-sms' && (role === 'admin' || role === 'cashier') && (
                <DebtSmsPanel isAdmin={role === 'admin'} />
              )}
              {activeTab === 'leads' && (role === 'admin' || role === 'cashier') && (
                <LeadsPanel courses={courses} onConverted={() => { refreshAllData(); handleActiveTabChange('students'); }} />
              )}
              {activeTab === 'email' && (role === 'admin' || role === 'cashier') && (
                <EmailPanel isAdmin={role === 'admin'} courses={courses.map((c) => ({ id: c.id, title: c.title }))} />
              )}
              {activeTab === 'site-requests' && (role === 'admin' || role === 'cashier') && (
                <SiteRequestsHistory courses={courses} />
              )}
              {activeTab === 'tasks' && currentUser && (
                <TasksPanel username={currentUser.username} isAdmin={role === 'admin'} onCountsChange={refreshTaskCounts} />
              )}
              {activeTab === 'campaigns' && role === 'admin' && (
                <BulkMessaging courses={courses} />
              )}
              {activeTab === 'settings' && role === 'admin' && (
                <Settings
                  courses={courses}
                  onRefresh={refreshAllData}
                />
              )}
            </div>
          )}
        </div>

      </main>
    </div>
    </CopilotProvider>
  );
}
