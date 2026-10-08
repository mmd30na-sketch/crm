import React, { useState } from 'react';
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
} from 'lucide-react';
import { Student, Course, Enrollment, Payment, Expense } from '../types';
import * as api from '../api/client';
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

const PAY_METHOD_LABELS: Record<string, string> = {
  pos: 'کارتخوان', cash: 'نقدی', card_transfer: 'کارت‌به‌کارت', online: 'آنلاین', cheque: 'چک',
};

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

function currentJalaliYearMonth() {
  const { jy, jm } = gregorianToJalali(new Date());
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

  const filteredPayments = payments.filter(p => inPeriod(p.pay_date_jalali));
  const filteredExpenses = expenses.filter(ex => inPeriod(ex.pay_date_jalali || ex.expense_date));

  /* Totals */
  const totalTuition     = enrollments.reduce((sum, e) => sum + (e.final_price || 0), 0);
  const totalPayments    = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalExpenses    = filteredExpenses.reduce((sum, ex) => sum + ex.amount, 0);
  const totalOutstanding = Math.max(0, totalTuition - payments.reduce((sum, p) => sum + p.amount, 0));
  const netProfit        = totalPayments - totalExpenses;

  /* ── 1. Area Chart Data from real ledger (no dummy padding) ── */
  const monthNames = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const monthlyMap: Record<string, { income: number; expense: number }> = {};
  monthNames.forEach(m => { monthlyMap[m] = { income: 0, expense: 0 }; });

  const monthFromJalali = (raw?: string): string | null => {
    const m = normJalali(raw).match(/^\d{4}\/(\d{2})/);
    if (!m) return null;
    return monthNames[Math.max(1, Math.min(12, parseInt(m[1], 10))) - 1];
  };
  filteredPayments.forEach(p => {
    const key = monthFromJalali(p.pay_date_jalali);
    if (key) monthlyMap[key].income += p.amount;
  });
  filteredExpenses.forEach(ex => {
    const key = monthFromJalali(ex.pay_date_jalali || ex.expense_date);
    if (key) monthlyMap[key].expense += ex.amount;
  });

  const areaChartData = monthNames.filter(m => monthlyMap[m].income || monthlyMap[m].expense).map(m => ({
    month: m,
    'درآمد (واریزی)': monthlyMap[m].income,
    'هزینه (خروجی)': monthlyMap[m].expense,
  }));

  /* ── 2. Bar Chart Data (Comparison by Course) ── */
  const courseComparisonData = courses.map(course => {
    const courseEnrollments = enrollments.filter(e => e.course_id === course.id);
    const courseTuition = courseEnrollments.reduce((sum, e) => sum + (e.final_price || 0), 0);
    const coursePayments = payments
      .filter(p => courseEnrollments.some(e => e.id === p.enrollment_id))
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      name: course.title.length > 15 ? course.title.slice(0, 15) + '...' : course.title,
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
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" />
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
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => [`${v.toLocaleString('fa-IR')} تومان`]} />
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

      {/* ── EXPENSE MODAL ── */}
      {isExpenseModalOpen && (
        <div className="carla-modal-overlay">
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
        </div>
      )}
    </div>
  );
}
