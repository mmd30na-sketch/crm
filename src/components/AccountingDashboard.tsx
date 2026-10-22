import React, { useState } from 'react';
import FilterSheet from './FilterSheet';
import {
  TrendingUp,
  CreditCard,
  PlusCircle,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  FileText,
  DollarSign,
  Calendar,
  X,
  PiggyBank,
  Briefcase,
  Activity,
  User,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  Filter,
  Plus,
  BarChart2,
  PieChart as PieIcon,
  Download,
} from 'lucide-react';
import { Student, Course, Enrollment, Payment, Expense } from '../types';
import * as api from '../api/client';
import { totalOutstanding as outstandingOf } from '../utils/finance';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';
import ModalPortal from './ModalPortal';
import { downloadCsv } from '../utils/exportCsv';
import DebtorsReport from './DebtorsReport';
import { jalaliTodayParts } from '../utils/normalize';
import { monthlySeries } from '../utils/charts';
import { PAY_METHOD_LABELS } from '../utils/labels';

interface AccountingDashboardProps {
  students: Student[];
  courses: Course[];
  enrollments: Enrollment[];
  payments: Payment[];
  expenses: Expense[];
  onRefresh: () => void;
}

const toEnglishDigits = (str: string): string => {
  if (!str) return '';
  const p = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  let out = str;
  for (let i = 0; i < 10; i++) out = out.replace(p[i], i.toString());
  return out;
};

/** "۱۴۰۵/۷/۱۶" → "1405/07/16": comparable text whatever digits/padding the record was saved with. */
const normJalali = (raw?: string): string => {
  const m = toEnglishDigits(raw || '').trim().match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : '';
};


function currentJalaliYearMonth() {
  const { jy, jm } = jalaliTodayParts();
  return `${jy}/${String(jm).padStart(2, '0')}`;
}

export default function AccountingDashboard({
  students,
  courses,
  enrollments,
  payments,
  expenses,
  onRefresh,
}: AccountingDashboardProps) {

  /* Default to 'all' so no data is filtered out on first load! */
  const [dateFilterMode, setDateFilterMode]   = useState<'all' | 'this_month' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate]     = useState('');
  // Course + course-number (term) scope for payments, tuition and outstanding totals.
  const [accCourse, setAccCourse] = useState('all');
  const [accTerm, setAccTerm]     = useState('all');

  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [expenseTitle, setExpenseTitle]             = useState('');
  const [expenseAmount, setExpenseAmount]           = useState('');
  const [expenseCategory, setExpenseCategory]       = useState('قبوض و نگهداری');
  const [expenseDesc, setExpenseDesc]               = useState('');
  const [isSubmittingExpense, setIsSubmittingExpense]= useState(false);

  const formatCurrency = (amount: number) => amount.toLocaleString('fa-IR') + ' تومان';

  /** Records without a readable date can't belong to a period, so they only show under "all". */
  const inPeriod = (rawDate?: string) => {
    if (dateFilterMode === 'all') return true;
    const d = normJalali(rawDate);
    if (!d) return false;
    if (dateFilterMode === 'this_month') return d.startsWith(currentJalaliYearMonth());
    if (customStartDate && customEndDate) return d >= normJalali(customStartDate) && d <= normJalali(customEndDate);
    return true;
  };

  // Only payments of an enrollment in the selected course/term count here: the server lists every payment
  // (also the ones without an enrollment), and those cannot be attributed to a course or term.
  const termNumbers = Array.from(new Set(enrollments
    .filter(e => accCourse === 'all' || String(e.course_id) === accCourse)
    .map(e => e.course_number).filter((n): n is number => n != null && Number(n) > 0))).sort((a, b) => b - a);
  const matchScope = (e: Enrollment) => (accCourse === 'all' || String(e.course_id) === accCourse) && (accTerm === 'all' || String(e.course_number ?? '') === accTerm);
  const scopedEnrollments = enrollments.filter(matchScope);
  const enrollmentIds = new Set(scopedEnrollments.map(e => e.id));
  const filteredPayments = payments.filter(p => p.enrollment_id != null && enrollmentIds.has(p.enrollment_id) && inPeriod(p.pay_date_jalali));
  const filteredExpenses = expenses.filter(ex => inPeriod(ex.pay_date_jalali || ex.expense_date));

  /* Totals */
  const totalTuition     = scopedEnrollments.reduce((sum, e) => sum + (e.final_price || 0), 0);
  const totalPayments    = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalExpenses    = filteredExpenses.reduce((sum, ex) => sum + ex.amount, 0);
  const totalOutstanding = outstandingOf(scopedEnrollments, payments); // per-enrollment balances, each clamped at 0
  const netProfit        = totalPayments - totalExpenses;

  /* Per-term summary (course + course_number): due, paid (all time), remaining (per enrollment, clamped at 0) */
  const paidByEnrollment = new Map<number, number>();
  payments.forEach(p => { if (p.enrollment_id != null) paidByEnrollment.set(p.enrollment_id, (paidByEnrollment.get(p.enrollment_id) || 0) + p.amount); });
  const termSummary = Array.from(scopedEnrollments.reduce((m, e) => {
    const key = `${e.course_id}|${e.course_number ?? ''}`;
    const row = m.get(key) || { course_id: e.course_id, course_number: e.course_number ?? null, count: 0, due: 0, paid: 0, remaining: 0 };
    const paid = paidByEnrollment.get(e.id) || 0;
    row.count += 1; row.due += e.final_price || 0; row.paid += paid; row.remaining += Math.max(0, (e.final_price || 0) - paid);
    m.set(key, row); return m;
  }, new Map<string, { course_id: number; course_number: number | null; count: number; due: number; paid: number; remaining: number }>()).values())
    .sort((a, b) => (b.course_number ?? -1) - (a.course_number ?? -1) || a.course_id - b.course_id);
  const courseTitle = (id: number) => courses.find(c => Number(c.id) === Number(id))?.title || `دوره ${id}`;

  /* ── 1. Area Chart Data from real ledger (no dummy padding) ── */
  // Grouped by year + month in calendar order (not by month name, which merged years and sorted
  // مهر/آبان/آذر of last year after this year's months); empty months in between stay on the axis.
  const areaChartData = monthlySeries(
    filteredPayments.map(p => ({ date: normJalali(p.pay_date_jalali), amount: p.amount })),
    filteredExpenses.map(ex => ({ date: normJalali(ex.pay_date_jalali || ex.expense_date), amount: ex.amount })),
  ).map(p => ({
    month: p.month,
    'درآمد (واریزی)': p.income,
    'هزینه (خروجی)': p.expense,
  }));

  /* ── 2. Bar Chart Data (Comparison by Course) ── */
  const courseComparisonData = courses.map(course => {
    const courseEnrollments = enrollments.filter(e => Number(e.course_id) === Number(course.id));
    const courseTuition = courseEnrollments.reduce((sum, e) => sum + (e.final_price || 0), 0);
    const coursePayments = payments
      .filter(p => courseEnrollments.some(e => e.id === p.enrollment_id))
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      name: course.title.length > 15 ? course.title.slice(0, 15) + '...' : course.title,
      fullTitle: course.title,
      'شهریه کل': courseTuition,
      'وصول شده': coursePayments,
    };
  });

  /* Ledger list */
  const ledgerItems = [
    ...filteredPayments.map(p => {
      const st = students.find(s => s.id === p.student_id);
      return {
        id: `pay_${p.id}`,
        type: 'income' as const,
        title: st ? `شهریه کارآموز: ${st.first_name} ${st.last_name}` : 'دریافتی صندوق',
        amount: p.amount,
        date: normJalali(p.pay_date_jalali) || '—',
        method: PAY_METHOD_LABELS[p.pay_method || ''] || p.pay_method || 'سایر',
        desc: p.description || 'ثبت قسط شهریه',
      };
    }),
    ...filteredExpenses.map(ex => ({
      id: `exp_${ex.id}`,
      type: 'expense' as const,
      title: ex.title,
      amount: ex.amount,
      date: normJalali(ex.pay_date_jalali || ex.expense_date) || '—',
      method: ex.category || ex.pay_method || 'هزینه جاری',
      desc: ex.description || 'ثبت خروجی صندوق',
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseTitle || !expenseAmount) return;
    setIsSubmittingExpense(true);
    try {
      await api.createExpense({
        title: expenseTitle,
        amount: parseFloat(expenseAmount),
        category: expenseCategory,
        description: expenseDesc,
      });
      onRefresh();
      setIsExpenseModalOpen(false);
      setExpenseTitle(''); setExpenseAmount(''); setExpenseDesc('');
    } catch (err: any) {
      alert(err?.message || 'خطا در ثبت هزینه');
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  return (
    <div className="space-y-5 fade-in" id="accounting-dashboard-root">
      
      {/* ── Header Toolbar ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
        style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
        
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 border border-sky-100 flex items-center justify-center font-bold">
            <PiggyBank className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">پیشخوان حسابداری و تحلیل نمودارهای مالی</h2>
            <p className="text-xs text-slate-400 mt-0.5">تحلیل آنلاین درآمدها، روند نقدینگی، بدهی کارآموزان و تراز هزینه‌ها</p>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => {
              const stu = new Map(students.map((st) => [st.id, st]));
              downloadCsv<Payment>(`payments-${new Date().toISOString().slice(0, 10)}`, filteredPayments, [
                { header: 'تاریخ', value: (p) => p.pay_date_jalali },
                { header: 'کارآموز', value: (p) => { const st = stu.get(p.student_id); return st ? `${st.first_name} ${st.last_name}` : p.student_id; } },
                { header: 'کد ملی', value: (p) => stu.get(p.student_id)?.national_code },
                { header: 'مبلغ', value: (p) => p.amount }, { header: 'روش', value: (p) => p.pay_method },
                { header: 'نوع', value: (p) => p.payment_kind }, { header: 'توضیحات', value: (p) => p.description },
              ]);
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition cursor-pointer">
            <Download className="w-3.5 h-3.5" />اکسل پرداخت‌ها
          </button>
          <button onClick={() => downloadCsv<Expense>(`expenses-${new Date().toISOString().slice(0, 10)}`, filteredExpenses, [
              { header: 'تاریخ', value: (e) => e.pay_date_jalali || e.expense_date }, { header: 'عنوان', value: (e) => e.title },
              { header: 'مبلغ', value: (e) => e.amount }, { header: 'دسته', value: (e) => e.category || e.pay_method },
              { header: 'توضیحات', value: (e) => e.description },
            ])}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition cursor-pointer">
            <Download className="w-3.5 h-3.5" />اکسل هزینه‌ها
          </button>
          <FilterSheet title="فیلتر حسابداری" count={(dateFilterMode !== 'all' ? 1 : 0) + (accCourse !== 'all' ? 1 : 0) + (accTerm !== 'all' ? 1 : 0)} onClear={() => { setDateFilterMode('all'); setCustomStartDate(''); setCustomEndDate(''); setAccCourse('all'); setAccTerm('all'); }}>
          <select value={accCourse} onChange={e => { setAccCourse(e.target.value); setAccTerm('all'); }} aria-label="دوره"
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-sky-400 cursor-pointer">
            <option value="all">همه دوره‌ها</option>
            {courses.map(c => <option key={c.id} value={String(c.id)}>{c.title}</option>)}
          </select>
          <select value={accTerm} onChange={e => setAccTerm(e.target.value)} aria-label="شماره دوره"
            className="px-3 py-2 text-xs border border-amber-200 bg-amber-50/50 font-bold text-amber-900 rounded-xl focus:outline-none cursor-pointer">
            <option value="all">همه شماره‌ها</option>
            {termNumbers.map(n => <option key={n} value={String(n)}>دوره شماره {n}</option>)}
          </select>
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold border border-slate-200">
            <button onClick={() => setDateFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${dateFilterMode === 'all' ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
              همه تراکنش‌ها
            </button>
            <button onClick={() => setDateFilterMode('this_month')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${dateFilterMode === 'this_month' ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
              ماه جاری
            </button>
            <button onClick={() => setDateFilterMode('custom')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${dateFilterMode === 'custom' ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
              تاریخ سفارشی
            </button>
          </div>

          {dateFilterMode === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs">
              <input type="text" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} placeholder="از 1404/01/01"
                className="w-28 px-2 py-1.5 border border-slate-200 rounded-lg font-mono text-center focus:outline-none focus:border-sky-400" />
              <input type="text" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} placeholder="تا 1404/12/29"
                className="w-28 px-2 py-1.5 border border-slate-200 rounded-lg font-mono text-center focus:outline-none focus:border-sky-400" />
            </div>
          )}
          </FilterSheet>

          <button onClick={() => setIsExpenseModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs">
            <Plus className="w-4 h-4" />ثبت هزینه جدید
          </button>
        </div>
      </div>

      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Tuition */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-sky-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">کل شهریه ثبت‌نامی</span>
              <span className="text-base font-black text-slate-900 font-mono">{formatCurrency(totalTuition)}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Cash Collected */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-emerald-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">وصول شده صندوق</span>
              <span className="text-base font-black text-emerald-600 font-mono">{formatCurrency(totalPayments)}</span>
            </div>
          </div>
        </div>

        {/* Card 3: Debt Outstanding */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-rose-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">مطالبات و مانده بدهی</span>
              <span className="text-base font-black text-rose-600 font-mono">{formatCurrency(totalOutstanding)}</span>
            </div>
          </div>
        </div>

        {/* Card 4: Net Profit */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div className="h-1 bg-violet-500 absolute top-0 inset-x-0" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block">خالص تراز مالی</span>
              <span className={`text-base font-black font-mono ${netProfit >= 0 ? 'text-violet-700' : 'text-rose-600'}`}>
                {formatCurrency(netProfit)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── TWO DUAL CHARTS SECTION (FULLY RESTORED & ENHANCED) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* CHART 1: Monthly Trend Area Chart (6 cols) */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-500" />نمودار روند جریان درآمد در برابر هزینه‌ها
            </h3>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={areaChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                {/* interval={0}: every month gets its label (the default skips labels when they are crowded) */}
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} angle={-35} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <Tooltip formatter={(v: any) => [`${v.toLocaleString('fa-IR')} تومان`]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="درآمد (واریزی)" stroke="#0ea5e9" strokeWidth={2.5} fillOpacity={1} fill="url(#incomeGrad)" />
                <Area type="monotone" dataKey="هزینه (خروجی)" stroke="#f43f5e" strokeWidth={2.5} fillOpacity={1} fill="url(#expenseGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 2: Course Breakdown Bar Chart (6 cols) */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-500" />نمودار مقایسه‌ای کل شهریه و میزان وصولی دوره‌ها
            </h3>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={courseComparisonData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                {/* interval={0}: one label per course (the default dropped labels, so a course looked missing) */}
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={60} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => [`${v.toLocaleString('fa-IR')} تومان`]} labelFormatter={(_l: any, p: any) => p?.[0]?.payload?.fullTitle ?? _l} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="شهریه کل" fill="#94a3b8" radius={[4, 4, 0, 0]} maxBarSize={25} />
                <Bar dataKey="وصول شده" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={25} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* ── Transaction Ledger Table ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-500" />دفتر کل تراکنش‌های واریزی و هزینه‌ها
          </h3>
          <span className="text-[10px] font-mono text-slate-400 font-bold">{ledgerItems.length} تراکنش ثبت‌شده</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold">
                <th className="p-3">نوع تراکنش</th>
                <th className="p-3">عنوان و شرح</th>
                <th className="p-3">مبلغ مالی</th>
                <th className="p-3">تاریخ سند</th>
                <th className="p-3">درگاه / دسته‌بندی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {ledgerItems.map(item => (
                <tr key={item.id} className="hover:bg-slate-50/60 transition">
                  <td className="p-3">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      item.type === 'income' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                    }`}>
                      {item.type === 'income' ? 'درآمد (واریزی)' : 'هزینه (خروجی)'}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-slate-800">
                    <div>{item.title}</div>
                    <div className="text-[10px] text-slate-400 font-normal">{item.desc}</div>
                  </td>
                  <td className="p-3 font-mono font-bold">
                    <span className={item.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}>
                      {item.type === 'income' ? '+' : '-'} {item.amount.toLocaleString('fa-IR')} تومان
                    </span>
                  </td>
                  <td className="p-3 font-mono text-slate-500">{item.date}</td>
                  <td className="p-3">
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg font-medium">{item.method}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Per-term summary ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-slate-800">خلاصه مالی به تفکیک شماره دوره</h3>
          <span className="text-[11px] text-slate-400">مبالغ به تومان</span>
        </div>
        {termSummary.length === 0 ? <div className="text-xs text-slate-400 py-6 text-center">ثبت‌نامی در این محدوده نیست.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="px-3 py-2.5">دوره</th><th className="px-3 py-2.5">شماره</th><th className="px-3 py-2.5">ثبت‌نام</th>
                <th className="px-3 py-2.5">کل شهریه</th><th className="px-3 py-2.5">پرداخت‌شده</th><th className="px-3 py-2.5">مانده</th>
              </tr></thead>
              <tbody>
                {termSummary.map(t => (
                  <tr key={`${t.course_id}|${t.course_number}`} className="border-t border-slate-100 hover:bg-sky-50/40 cursor-pointer"
                    onClick={() => { setAccCourse(String(t.course_id)); setAccTerm(t.course_number != null ? String(t.course_number) : 'all'); }}>
                    <td className="px-3 py-2.5 font-bold text-slate-800">{courseTitle(t.course_id)}</td>
                    <td className="px-3 py-2.5">{t.course_number != null ? t.course_number.toLocaleString('fa-IR') : 'بدون شماره'}</td>
                    <td className="px-3 py-2.5">{t.count.toLocaleString('fa-IR')}</td>
                    <td className="px-3 py-2.5">{t.due.toLocaleString('fa-IR')}</td>
                    <td className="px-3 py-2.5 text-emerald-700">{t.paid.toLocaleString('fa-IR')}</td>
                    <td className={`px-3 py-2.5 ${t.remaining > 0 ? 'text-rose-600 font-bold' : ''}`}>{t.remaining.toLocaleString('fa-IR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── EXPENSE MODAL ── */}
      {isExpenseModalOpen && (
        <ModalPortal><div className="carla-modal-overlay">
          <div className="carla-modal p-6 space-y-4" style={{ maxWidth: 420 }}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-rose-600" />ثبت هزینه جدید آموزشگاه
              </h3>
              <button onClick={() => setIsExpenseModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>

            <form onSubmit={handleSaveExpense} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">عنوان هزینه *</label>
                <input type="text" required value={expenseTitle} onChange={e => setExpenseTitle(e.target.value)} placeholder="مثال: قبوض یا سوخت خودروها"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-rose-400" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">مبلغ هزینه (تومان) *</label>
                <input type="number" required value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} placeholder="مثال: 500000"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:outline-none focus:border-rose-400" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">دسته‌بندی</label>
                <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-rose-400 bg-white">
                  <option value="قبوض و نگهداری">قبوض و نگهداری آموزشگاه</option>
                  <option value="سوخت و استهلاک خودروها">سوخت و استهلاک خودروها</option>
                  <option value="حقوق مربیان و پرسنل">حقوق مربیان و پرسنل</option>
                  <option value="ملزومات اداری و تبلیغات">ملزومات اداری و تبلیغات</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="px-4 py-2 text-xs font-bold bg-slate-100 text-slate-700 rounded-lg">انصراف</button>
                <button type="submit" disabled={isSubmittingExpense} className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition shadow-xs">
                  {isSubmittingExpense ? 'در حال ثبت...' : 'ثبت قطعی هزینه'}
                </button>
              </div>
            </form>
          </div>
        </div></ModalPortal>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4" id="debtors-report">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-rose-600" />گزارش بدهکاران</h3>
        <DebtorsReport students={students} courses={courses} enrollments={enrollments} payments={payments} />
      </div>
    </div>
  );
}
