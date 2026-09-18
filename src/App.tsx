import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  BarChart3,
  Settings as SettingsIcon,
  Calendar,
  Bell,
  FileText,
  Menu,
  LayoutDashboard,
  MessageSquare,
  ChevronLeft,
  RefreshCw,
  Wifi,
} from 'lucide-react';
import { Student, Course, Enrollment, Payment, Expense } from './types';
import * as api from './api/client';
import StudentList from './components/StudentList';
import StudentRegistrationForm from './components/StudentRegistrationForm';
import AccountingDashboard from './components/AccountingDashboard';
import Settings from './components/Settings';
import SupervisorDashboard from './components/SupervisorDashboard';
import MessengerHub from './components/MessengerHub';

const NAV_ITEMS = [
  {
    id: 'supervisor',
    label: 'داشبورد نظارت',
    sublabel: 'کنترل و نمای کلی',
    icon: LayoutDashboard,
    color: 'brand',
  },
  {
    id: 'students',
    label: 'داشبورد کارآموزان',
    sublabel: 'مدیریت هنرجویان',
    icon: Users,
    color: 'teal',
  },
  {
    id: 'register',
    label: 'ثبت‌نام هوشمند',
    sublabel: 'OCR کارت ملی',
    icon: UserPlus,
    color: 'purple',
  },
  {
    id: 'accounting',
    label: 'حسابداری مالی',
    sublabel: 'درآمد و مخارج',
    icon: BarChart3,
    color: 'amber',
  },
  {
    id: 'messenger',
    label: 'پیام‌رسان کارلا',
    sublabel: 'مرکز ارتباطی',
    icon: MessageSquare,
    color: 'rose',
  },
  {
    id: 'settings',
    label: 'تنظیمات آموزشگاه',
    sublabel: 'پیکربندی سیستم',
    icon: SettingsIcon,
    color: 'slate',
  },
];

const ICON_COLOR_MAP: Record<string, string> = {
  brand:  'text-sky-400',
  teal:   'text-teal-400',
  purple: 'text-violet-400',
  amber:  'text-amber-400',
  rose:   'text-rose-400',
  slate:  'text-slate-400',
};

const ACTIVE_BADGE_MAP: Record<string, string> = {
  brand:  'bg-sky-500/20 text-sky-300',
  teal:   'bg-teal-500/20 text-teal-300',
  purple: 'bg-violet-500/20 text-violet-300',
  amber:  'bg-amber-500/20 text-amber-300',
  rose:   'bg-rose-500/20 text-rose-300',
  slate:  'bg-slate-500/20 text-slate-300',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('supervisor');
  const [loading, setLoading] = useState<boolean>(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const refreshAllData = async () => {
    setIsRefreshing(true);
    try {
      const [stdData, crsData, enrData, payData, expData] = await Promise.all([
        api.fetchStudents(),
        api.fetchCourses(),
        api.fetchEnrollments(),
        api.fetchPayments(),
        api.fetchExpenses(),
      ]);
      setStudents(stdData);
      setCourses(crsData);
      setEnrollments(enrData);
      setPayments(payData);
      setExpenses(expData);
    } catch (err) {
      console.error('Error fetching dashboard datasets:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => { refreshAllData(); }, []);

  const handleActiveTabChange = (newTab: string) => setActiveTab(newTab);

  const activeNavItem = NAV_ITEMS.find(n => n.id === activeTab);

  // Jalali date (static demo)
  const jalaliDate = '۷ مرداد ۱۴۰۵';

  return (
    <div
      className="flex h-screen w-screen overflow-hidden text-slate-900"
      style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f8fafc 50%, #f0fdf4 100%)' }}
      dir="rtl"
      id="app-root"
    >
      {/* ═══════════════════════════════════════════════
          SIDEBAR — Dark Premium Navigation
      ═══════════════════════════════════════════════ */}
      <aside
        className={`carla-sidebar flex flex-col shrink-0 transition-all duration-300 ease-in-out ${
          isSidebarOpen ? 'w-64 opacity-100' : 'w-0 opacity-0 pointer-events-none overflow-hidden'
        }`}
        id="app-sidebar"
      >
        {/* Brand Header */}
        <div className="p-5 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="carla-brand-logo">
              <span className="text-white font-black text-base leading-none">C</span>
            </div>
            <div>
              <h1 className="text-white text-base font-bold tracking-tight leading-tight">Carla CRM</h1>
              <p className="text-slate-500 text-[9px] uppercase tracking-widest font-semibold">آموزشگاه رانندگی</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-white/5" />

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p className="carla-section-title px-3 mb-2">منوی اصلی</p>

          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                onClick={() => handleActiveTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 text-right group ${
                  isActive
                    ? 'bg-gradient-to-l from-sky-600 to-sky-500 text-white shadow-lg shadow-sky-900/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/6'
                }`}
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
                    isActive ? 'text-sky-100/80' : 'text-slate-600 group-hover:text-slate-400'
                  }`}>
                    {item.sublabel}
                  </div>
                </div>
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)] shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-white/5">
          {/* Server Status */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 mb-3">
            <div className="pulse-dot green" />
            <span className="text-[10px] text-slate-400 font-medium flex-1">سرور فعال</span>
            <Wifi className="h-3 w-3 text-slate-600" />
          </div>
          {/* User Card */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/5">
            <div className="h-8 w-8 rounded-xl overflow-hidden border border-white/10 shrink-0">
              <img
                src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=64&h=64&q=80"
                alt="اپراتور"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-300 leading-tight truncate">مدیریت پذیرش</div>
              <div className="text-[9px] text-slate-600 leading-tight">نسخه ۲.۴.۰ نهایی</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════
          MAIN CONTENT
      ═══════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col overflow-hidden" id="main-view-wrapper">

        {/* ── HEADER ── */}
        <header
          className="carla-header h-16 px-6 flex items-center justify-between shrink-0"
          id="main-header"
        >
          {/* Left: Sidebar Toggle + Breadcrumb */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-xl text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all"
              title={isSidebarOpen ? 'بستن منو' : 'باز کردن منو'}
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-slate-400 font-medium">کارلا</span>
              <ChevronLeft className="h-3.5 w-3.5 text-slate-300" />
              {activeNavItem && (
                <div className="flex items-center gap-1.5">
                  <activeNavItem.icon className={`h-4 w-4 ${ICON_COLOR_MAP[activeNavItem.color]}`} />
                  <span className="font-semibold text-slate-700">{activeNavItem.label}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-2">
            {/* Refresh */}
            <button
              onClick={refreshAllData}
              className={`p-2 rounded-xl text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all ${isRefreshing ? 'animate-spin text-sky-500' : ''}`}
              title="بارگذاری مجدد"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            {/* Separator */}
            <div className="h-6 w-px bg-slate-200" />

            {/* Online Badge */}
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
              <span className="pulse-dot green" style={{ width: 7, height: 7 }} />
              <span className="text-[10px] font-bold text-emerald-700">API متصل</span>
            </div>

            {/* Date */}
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-1.5">
              <Calendar className="h-3.5 w-3.5 text-sky-400" />
              <span className="font-bold font-mono text-[11px] text-slate-600">{jalaliDate}</span>
            </div>

            {/* Notification */}
            <button className="relative p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all">
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-white" />
            </button>

            {/* Separator */}
            <div className="h-6 w-px bg-slate-200" />

            {/* User Avatar */}
            <div className="flex items-center gap-2.5 pl-1">
              <div className="hidden md:block text-right">
                <div className="text-xs font-bold text-slate-700 leading-tight">مدیریت پذیرش</div>
                <div className="text-[9px] text-slate-400">صندوق‌دار سیستم</div>
              </div>
              <div className="h-8 w-8 rounded-xl overflow-hidden border-2 border-sky-100 ring-1 ring-sky-200/50">
                <img
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=64&h=64&q=80"
                  alt="اپراتور کارلا"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </header>

        {/* ── CONTENT AREA ── */}
        <div
          className="flex-1 overflow-y-auto p-6 space-y-5"
          id="main-content-scroll"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-40 space-y-4 fade-in">
              <div className="carla-spinner" />
              <p className="text-sm text-slate-400 font-medium">در حال بارگذاری داده‌ها...</p>
            </div>
          ) : (
            <div className="fade-in">
              {activeTab === 'supervisor' && (
                <SupervisorDashboard
                  students={students}
                  courses={courses}
                  enrollments={enrollments}
                  payments={payments}
                  onRefresh={refreshAllData}
                  onActiveTabChange={handleActiveTabChange}
                  isSidebarOpen={isSidebarOpen}
                />
              )}
              {activeTab === 'students' && (
                <StudentList
                  students={students}
                  courses={courses}
                  enrollments={enrollments}
                  payments={payments}
                  onRefresh={refreshAllData}
                  onActiveTabChange={handleActiveTabChange}
                />
              )}
              {activeTab === 'register' && (
                <StudentRegistrationForm
                  courses={courses}
                  enrollments={enrollments}
                  onRefresh={refreshAllData}
                  onActiveTabChange={handleActiveTabChange}
                />
              )}
              {activeTab === 'accounting' && (
                <AccountingDashboard
                  students={students}
                  courses={courses}
                  enrollments={enrollments}
                  payments={payments}
                  expenses={expenses}
                  onRefresh={refreshAllData}
                />
              )}
              {activeTab === 'messenger' && (
                <MessengerHub
                  students={students}
                  onRefresh={refreshAllData}
                />
              )}
              {activeTab === 'settings' && (
                <Settings
                  courses={courses}
                  onRefresh={refreshAllData}
                />
              )}
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <footer
          className="carla-footer px-6 py-2.5 flex items-center justify-between shrink-0"
          id="app-footer"
        >
          <div className="flex items-center gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="pulse-dot green" style={{ width: 6, height: 6 }} />
              درگاه: متصل
            </span>
            <span>آرشیو رسید: فعال</span>
            <span>Carla CRM v2.4.0</span>
          </div>
          <div className="text-[10px] text-slate-400">
            سیستم جامع مدیریت آموزشگاه رانندگی کارلا
          </div>
        </footer>
      </main>
    </div>
  );
}
