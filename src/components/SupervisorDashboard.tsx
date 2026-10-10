import React, { useState, useEffect, useRef } from 'react';
import {
  TrendingUp,
  Users,
  CheckCircle,
  AlertCircle,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Clock,
  Briefcase,
  Layers,
  Sparkles,
  DollarSign,
  PieChart as PieIcon,
  CheckSquare,
  MessageSquare,
  Send,
  X,
  ChevronLeft,
} from 'lucide-react';
import { Student, Course, Enrollment, Payment } from '../types';
import * as api from '../api/client';
import { totalOutstanding } from '../utils/finance';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

interface SupervisorDashboardProps {
  students: Student[];
  courses: Course[];
  enrollments: Enrollment[];
  payments: Payment[];
  onRefresh: () => void;
  onActiveTabChange: (tab: string) => void;
  isSidebarOpen?: boolean;
}

interface CalendarEvent {
  day: number;
  month?: number;
  year?: number;
  title: string;
  time: string;
}

interface Task {
  id: number;
  text: string;
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
}

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function gregorianToJalali(date: Date) {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  let gy2 = gy <= 1600 ? gy - 621 : gy - 1600;
  const gy2m = gm > 2 ? gy2 + 1 : gy2;
  let days = 365 * gy2 + Math.floor((gy2m + 3) / 4) - Math.floor((gy2m + 99) / 100) + Math.floor((gy2m + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

const isJalaliLeap = (jy: number) => [1, 5, 9, 13, 17, 22, 26, 30].includes(jy % 33);

function jalaliMonthLength(jm: number, jy: number) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

export default function SupervisorDashboard({
  students,
  courses,
  enrollments,
  payments,
  onRefresh,
  onActiveTabChange,
  isSidebarOpen = true,
}: SupervisorDashboardProps) {

  // To-do list and calendar events live on the server so every admin sees the same ones.
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const notesLoaded = useRef(false);

  const todayJalali = gregorianToJalali(new Date());
  const currentMonth = `${JALALI_MONTHS[todayJalali.jm - 1]} ${todayJalali.jy}`;
  const daysInMonth = jalaliMonthLength(todayJalali.jm, todayJalali.jy);
  // Persian weeks start on Saturday; getDay(): Sunday = 0 … Saturday = 6.
  const todayWeekdayIndex = (new Date().getDay() + 1) % 7;
  const firstDayOffset = (((todayWeekdayIndex - (todayJalali.jd - 1)) % 7) + 7) % 7;
  const eventsOn = (day: number) => calendarEvents.filter(e => e.day === day && e.year === todayJalali.jy && e.month === todayJalali.jm);
  const weekdayLabel = new Date().toLocaleDateString('fa-IR', { weekday: 'long' });

  const [isCalendarOpen, setIsCalendarOpen]   = useState(false);
  const [selectedDay, setSelectedDay]         = useState(todayJalali.jd);
  const [newEventTitle, setNewEventTitle]     = useState('');
  const [newEventTime, setNewEventTime]       = useState('10:00');
  const [newEventDay, setNewEventDay]         = useState(todayJalali.jd);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const notes = await api.fetchDashboardNotes();
        let loadedTasks: Task[] = notes.tasks || [];
        let loadedEvents: CalendarEvent[] = notes.events || [];
        // One-time move of notes that were kept in this browser before they were shared.
        if (loadedTasks.length === 0 && loadedEvents.length === 0) {
          try {
            loadedTasks = JSON.parse(localStorage.getItem('carla_tasks') || '[]');
            loadedEvents = JSON.parse(localStorage.getItem('carla_calendar_events') || '[]');
          } catch { /* ignore */ }
        }
        // Events saved before months were recorded belong to the current month.
        loadedEvents = loadedEvents.map(e => ({ ...e, year: e.year || todayJalali.jy, month: e.month || todayJalali.jm }));
        if (!cancelled) { setTasks(loadedTasks); setCalendarEvents(loadedEvents); }
      } catch { /* not allowed or offline: start empty */ }
      finally { notesLoaded.current = true; }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!notesLoaded.current) return;
    const timer = setTimeout(() => { api.saveDashboardNotes({ tasks, events: calendarEvents }).catch(() => {}); }, 600);
    return () => clearTimeout(timer);
  }, [tasks, calendarEvents]);

  const handleToggleTask = (id: number) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    setTasks(prev => [
      { id: Date.now(), text: newTaskText.trim(), completed: false, priority: 'medium' },
      ...prev,
    ]);
    setNewTaskText('');
  };

  const handleDeleteTask = (id: number) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) return;
    setCalendarEvents(prev => [
      ...prev,
      { day: newEventDay, month: todayJalali.jm, year: todayJalali.jy, title: newEventTitle.trim(), time: newEventTime },
    ]);
    setNewEventTitle('');
  };

  /* Analytics calculations */
  const totalStudentsCount   = students.length;
  const activeStudentsCount  = students.filter(s => s.status === 'active').length;
  const totalTuitionRevenue  = enrollments.reduce((sum, e) => sum + (e.final_price || 0), 0);
  const totalReceivedCash    = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalOutstandingDebt = totalOutstanding(enrollments, payments); // per-enrollment balances, each clamped at 0

  const courseDistribution = courses.map(course => {
    const count = enrollments.filter(e => e.course_id === course.id).length;
    return {
      name: course.title.length > 14 ? course.title.slice(0, 13) + '…' : course.title,
      fullTitle: course.title,
      'تعداد هنرجو': count,
    };
  });

  const formatCurrency = (n: number) => n.toLocaleString('fa-IR') + ' تومان';

  return (
    <div className="space-y-5 fade-in" id="supervisor-dashboard-root">

      {/* ── Top Header Banner ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
        style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-sky-500 text-white flex items-center justify-center font-bold shadow-md shadow-sky-200">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">داشبورد نظارت و مدیریت ارشد کارلا</h2>
            <p className="text-xs text-slate-400 mt-0.5">خلاصه آماری ثبت‌نام‌ها، درآمد نقدینگی، توزیع دوره‌ها و تقویم آموزشی</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => onActiveTabChange('register')}
            className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs">
            <Plus className="w-4 h-4" />ثبت‌نام جدید
          </button>
          <button onClick={() => onActiveTabChange('students')}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer">
            <Users className="w-4 h-4 text-sky-500" />لیست کل پرونده‌ها
          </button>
        </div>
      </div>

      {/* ── 4 Key KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Students */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-sky-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">کل پرونده‌های ثبت‌شده</span>
              <span className="text-xl font-black text-slate-900 font-mono">{totalStudentsCount} نفر</span>
            </div>
          </div>
        </div>

        {/* Card 2: Active Students */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-emerald-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">کارآموزان فعال و در حال آموزش</span>
              <span className="text-xl font-black text-emerald-600 font-mono">{activeStudentsCount} نفر</span>
            </div>
          </div>
        </div>

        {/* Card 3: Total Cash Collected */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-teal-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">وصولی صندوق</span>
              <span className="text-base font-black text-teal-600 font-mono">{formatCurrency(totalReceivedCash)}</span>
            </div>
          </div>
        </div>

        {/* Card 4: Outstanding Debt */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-rose-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">مانده بدهی شهریه</span>
              <span className="text-base font-black text-rose-600 font-mono">{formatCurrency(totalOutstandingDebt)}</span>
            </div>
          </div>
        </div>

      </div>

      {/* ── Visual Analytics Section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* Financial Pie Ratio (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-sky-500" />نسبت تسویه حساب مالی
            </h3>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              {totalTuitionRevenue > 0 ? Math.round((totalReceivedCash / totalTuitionRevenue) * 100) : 0}% تسویه
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-36 h-36 relative shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[
                    { name: 'وصول شده', value: totalReceivedCash, fill: '#10b981' },
                    { name: 'مانده بدهی', value: totalOutstandingDebt, fill: '#f43f5e' },
                  ]} dataKey="value" innerRadius={40} outerRadius={60} paddingAngle={4}>
                    <Cell fill="#10b981" />
                    <Cell fill="#f43f5e" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs font-mono font-bold text-slate-800">
                  {totalTuitionRevenue > 0 ? Math.round((totalReceivedCash / totalTuitionRevenue) * 100) : 0}%
                </span>
                <span className="text-[8px] text-slate-400 font-semibold">تکمیل</span>
              </div>
            </div>

            <div className="flex-1 space-y-2 text-xs">
              <div className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
                <span className="text-[10px] text-slate-400 block">دریافتی نقد:</span>
                <strong className="text-emerald-700 font-mono text-xs">{formatCurrency(totalReceivedCash)}</strong>
              </div>
              <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl">
                <span className="text-[10px] text-slate-400 block">مانده کل:</span>
                <strong className="text-rose-700 font-mono text-xs">{formatCurrency(totalOutstandingDebt)}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Course Bar Distribution (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-500" />توزیع کارآموزان به تفکیک دوره‌ها
            </h3>
            <span className="text-[10px] text-slate-400">{courses.length} دوره فعال</span>
          </div>

          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={courseDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip formatter={(value: any, name: any, props: any) => [value, props.payload.fullTitle]} />
                <Bar dataKey="تعداد هنرجو" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={35} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* ── Tasks & Calendar Widget Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        
        {/* Task List Widget */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-sky-500" />یادآور و وظایف اداری آموزشگاه
            </h3>
            <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">
              {tasks.filter(t => !t.completed).length} کار باقی‌مانده
            </span>
          </div>

          <form onSubmit={handleAddTask} className="flex gap-2">
            <input
              type="text"
              value={newTaskText}
              onChange={e => setNewTaskText(e.target.value)}
              placeholder="یادداشت کار جدید..."
              className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400"
            />
            <button type="submit" className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl transition cursor-pointer">
              + افزودن
            </button>
          </form>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {tasks.map(task => (
              <div key={task.id} className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs transition ${
                task.completed ? 'bg-slate-50 border-slate-100 text-slate-400 line-through' : 'bg-white border-slate-200 text-slate-800'
              }`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={task.completed} onChange={() => handleToggleTask(task.id)} className="h-4 w-4 text-sky-600 rounded cursor-pointer" />
                  <span className="font-semibold">{task.text}</span>
                </div>
                <button onClick={() => handleDeleteTask(task.id)} className="text-slate-400 hover:text-rose-500 transition">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Interactive Calendar Widget */}
        <div onClick={() => setIsCalendarOpen(true)}
          className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 cursor-pointer hover:border-sky-300 transition group" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-sky-500 group-hover:scale-110 transition-transform" />تقویم آموزشی و برنامه‌ها
            </h3>
            <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">
              مشاهده تقویم کامل ←
            </span>
          </div>

          <div className="flex items-center gap-4 py-1">
            <div className="w-16 h-16 bg-gradient-to-br from-sky-600 to-sky-500 text-white rounded-2xl flex flex-col items-center justify-center shrink-0 shadow-md shadow-sky-200">
              <span className="text-xl font-black font-mono leading-none">{String(todayJalali.jd)}</span>
              <span className="text-[10px] font-bold mt-1">{currentMonth}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 block">امروز:</span>
              <h4 className="text-sm font-extrabold text-slate-900">{weekdayLabel}، {todayJalali.jd} {currentMonth}</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {eventsOn(todayJalali.jd).length
                  ? eventsOn(todayJalali.jd).map(e => e.title).join('، ')
                  : 'رویدادی ثبت نشده'}
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ── CALENDAR POPUP MODAL ── */}
      {isCalendarOpen && (
        <div className="carla-modal-overlay" onClick={() => setIsCalendarOpen(false)}>
          <div className="carla-modal p-6 space-y-4 max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">تقویم کلاسی و برنامه‌های {currentMonth}</h3>
              </div>
              <button onClick={() => setIsCalendarOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>

            {/* Grid Days */}
            <div className="grid grid-cols-7 text-center gap-1.5 text-xs">
              {['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(d => <div key={d} className="font-bold text-slate-400 py-1 text-[10px]">{d}</div>)}
              {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`blank-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const hasEvt = eventsOn(day).length > 0;
                const isSel = selectedDay === day;
                return (
                  <button key={day} onClick={() => { setSelectedDay(day); setNewEventDay(day); }}
                    className={`aspect-square rounded-lg font-mono font-bold transition flex items-center justify-center cursor-pointer text-xs ${
                      isSel ? 'bg-sky-600 text-white shadow-xs' : hasEvt ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}>
                    {day}
                  </button>
                );
              })}
            </div>

            {/* Events for selected day */}
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <div className="text-xs font-bold text-slate-800">برنامه‌های روز {selectedDay} {currentMonth}:</div>
              {eventsOn(selectedDay).map((evt, idx) => (
                <div key={idx} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{evt.title}</span>
                  <span className="font-mono text-[10px] text-sky-700 font-bold">{evt.time}</span>
                </div>
              ))}

              {/* Add event */}
              <form onSubmit={handleAddEvent} className="flex gap-2 pt-2">
                <input type="text" value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)} placeholder="عنوان رویداد جدید..." className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <input type="text" value={newEventTime} onChange={e => setNewEventTime(e.target.value)} placeholder="۱۰:۰۰" className="w-16 px-2 py-1.5 text-xs border border-slate-200 rounded-lg font-mono text-center" />
                <button type="submit" className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition cursor-pointer">+ ثبت</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
