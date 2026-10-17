import React, { useMemo, useState } from 'react';
import FilterSheet from './FilterSheet';
import {
  Users,
  AlertCircle,
  CreditCard,
  DollarSign,
  Search,
  Filter,
  ArrowUpDown,
  Download,
  BookOpen,
} from 'lucide-react';
import { Student, Course, Enrollment, Payment } from '../types';
import { studentBalance } from '../utils/finance';
import { downloadCsv } from '../utils/exportCsv';
import { searchKey } from '../utils/normalize';

interface DebtorsReportProps {
  students: Student[];
  courses: Course[];
  enrollments: Enrollment[];
  payments: Payment[];
}

interface DebtorRow {
  student: Student;
  fullName: string;
  phoneNumber: string;
  nationalCode: string;
  courseTitles: string;
  courseIds: Set<number>;
  totalTuition: number;
  totalPaid: number;
  debt: number;
  lastPaymentDate: string;
}

type SortOption = 'debt_desc' | 'oldest_payment' | 'name_asc';

export default function DebtorsReport({
  students,
  courses,
  enrollments,
  payments,
}: DebtorsReportProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
  const [sortOption, setSortOption] = useState<SortOption>('debt_desc');

  // Map courses by ID for quick title lookup
  const courseMap = useMemo(() => {
    const map = new Map<number, Course>();
    for (const c of courses) {
      map.set(Number(c.id), c);
    }
    return map;
  }, [courses]);

  // Compute debtors list
  const debtorRows = useMemo<DebtorRow[]>(() => {
    const enrByStudent = new Map<number, Enrollment[]>();
    for (const e of enrollments) {
      const sid = Number(e.student_id);
      if (!enrByStudent.has(sid)) enrByStudent.set(sid, []);
      enrByStudent.get(sid)!.push(e);
    }

    const payByStudent = new Map<number, Payment[]>();
    for (const p of payments) {
      const sid = Number(p.student_id);
      if (!payByStudent.has(sid)) payByStudent.set(sid, []);
      payByStudent.get(sid)!.push(p);
    }

    const list: DebtorRow[] = [];

    for (const student of students) {
      const sid = Number(student.id);
      const studentEnrs = enrByStudent.get(sid) || [];
      const studentPays = payByStudent.get(sid) || [];

      const { totalTuition, totalPaid, debt } = studentBalance(studentEnrs, studentPays);

      if (debt > 0) {
        const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || '—';
        const courseIds = new Set<number>(studentEnrs.map((e) => Number(e.course_id)));
        const courseTitles = studentEnrs
          .map((e) => courseMap.get(Number(e.course_id))?.title || `دوره #${e.course_id}`)
          .join('، ');

        // Max pay_date_jalali string from student's payments
        let lastPaymentDate = '—';
        const validDates = studentPays
          .map((p) => p.pay_date_jalali)
          .filter((d): d is string => typeof d === 'string' && d.trim().length > 0);

        if (validDates.length > 0) {
          validDates.sort((a, b) => a.localeCompare(b));
          lastPaymentDate = validDates[validDates.length - 1];
        }

        list.push({
          student,
          fullName,
          phoneNumber: student.phone_number || '',
          nationalCode: student.national_code || '',
          courseTitles: courseTitles || '—',
          courseIds,
          totalTuition,
          totalPaid,
          debt,
          lastPaymentDate,
        });
      }
    }

    return list;
  }, [students, enrollments, payments, courseMap]);

  // Summary figures over all computed debtors
  const summary = useMemo(() => {
    let totalDebt = 0;
    let totalTuition = 0;
    let totalPaid = 0;
    for (const r of debtorRows) {
      totalDebt += r.debt;
      totalTuition += r.totalTuition;
      totalPaid += r.totalPaid;
    }
    return {
      count: debtorRows.length,
      totalDebt,
      totalTuition,
      totalPaid,
    };
  }, [debtorRows]);

  // Filter & sort
  const filteredRows = useMemo(() => {
    const term = searchKey(searchTerm);

    return debtorRows
      .filter((row) => {
        // Course filter
        if (selectedCourseId !== 'all') {
          const cid = Number(selectedCourseId);
          if (!row.courseIds.has(cid)) return false;
        }

        // Text search filter (name, phone, national code)
        if (term) {
          const nameMatch = searchKey(row.fullName).includes(term);
          const phoneMatch = searchKey(row.phoneNumber).includes(term);
          const natMatch = searchKey(row.nationalCode).includes(term);
          if (!nameMatch && !phoneMatch && !natMatch) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortOption === 'debt_desc') {
          return b.debt - a.debt;
        }
        if (sortOption === 'oldest_payment') {
          // '—' (no payment) comes before or after? Usually oldest date string first.
          // If one has no payment, place at start or end consistently.
          if (a.lastPaymentDate === '—' && b.lastPaymentDate === '—') return 0;
          if (a.lastPaymentDate === '—') return -1;
          if (b.lastPaymentDate === '—') return 1;
          return a.lastPaymentDate.localeCompare(b.lastPaymentDate);
        }
        if (sortOption === 'name_asc') {
          return a.fullName.localeCompare(b.fullName, 'fa');
        }
        return 0;
      });
  }, [debtorRows, searchTerm, selectedCourseId, sortOption]);

  const handleExportCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `debtors-${today}.csv`;
    const numbered = filteredRows.map((r, i) => ({ ...r, rowNo: i + 1 }));
    downloadCsv<DebtorRow & { rowNo: number }>(filename, numbered, [
      { header: 'ردیف', value: (r) => r.rowNo },
      { header: 'نام و نام خانوادگی', value: (r) => r.fullName },
      { header: 'شماره موبایل', value: (r) => r.phoneNumber },
      { header: 'کد ملی', value: (r) => r.nationalCode },
      { header: 'دوره‌ها', value: (r) => r.courseTitles },
      { header: 'شهریه کل (تومان)', value: (r) => r.totalTuition },
      { header: 'پرداختی (تومان)', value: (r) => r.totalPaid },
      { header: 'مانده بدهی (تومان)', value: (r) => r.debt },
      { header: 'آخرین پرداخت', value: (r) => r.lastPaymentDate },
    ]);
  };

  return (
    <div className="space-y-6 text-slate-800" dir="rtl">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Count Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">تعداد بدهکاران</p>
              <h3 className="text-2xl font-bold text-slate-800">
                {summary.count.toLocaleString('fa-IR')} نفر
              </h3>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Users className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Total Debt Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">مجموع کل بدهی</p>
              <h3 className="text-2xl font-bold text-rose-600">
                {summary.totalDebt.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-500">تومان</span>
              </h3>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600">
              <AlertCircle className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Total Tuition Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">مجموع شهریه بدهکاران</p>
              <h3 className="text-2xl font-bold text-slate-800">
                {summary.totalTuition.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-500">تومان</span>
              </h3>
            </div>
            <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-600">
              <DollarSign className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Total Paid Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">مجموع پرداختی بدهکاران</p>
              <h3 className="text-2xl font-bold text-emerald-600">
                {summary.totalPaid.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-500">تومان</span>
              </h3>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
              <CreditCard className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="جستجو با نام، موبایل یا کد ملی..."
              className="w-full pr-9 pl-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-400 transition"
            />
          </div>

          <div className="flex items-center gap-2 sm:contents">
          <FilterSheet title="فیلتر بدهکاران" count={(selectedCourseId !== 'all' ? 1 : 0) + (sortOption !== 'debt_desc' ? 1 : 0)} onClear={() => { setSelectedCourseId('all'); setSortOption('debt_desc'); }}>
          {/* Course Filter */}
          <div className="relative sm:w-56">
            <Filter className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              aria-label="فیلتر بر اساس دوره"
              className="w-full pr-9 pl-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-400 appearance-none transition cursor-pointer"
            >
              <option value="all">همه دورهها</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Select */}
          <div className="relative sm:w-48">
            <ArrowUpDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              aria-label="مرتبسازی بدهکاران"
              className="w-full pr-9 pl-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-400 appearance-none transition cursor-pointer"
            >
              <option value="debt_desc">بیشترین بدهی</option>
              <option value="oldest_payment">قدیمیترین پرداخت</option>
              <option value="name_asc">نام</option>
            </select>
          </div>
          </FilterSheet>
          </div>
        </div>

        {/* Export Button */}
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filteredRows.length === 0}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition shadow-sm shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>خروجی اکسل</span>
        </button>
      </div>

      {/* Debtors Table / Empty State */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <BookOpen className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-slate-600">هیچ بدهکاری وجود ندارد</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-right border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3 px-4 w-12 text-center">ردیف</th>
                  <th className="py-3 px-4 min-w-[140px]">نام</th>
                  <th className="py-3 px-4 min-w-[110px]">موبایل</th>
                  <th className="py-3 px-4 min-w-[160px]">دوره</th>
                  <th className="py-3 px-4 min-w-[110px]">شهریه</th>
                  <th className="py-3 px-4 min-w-[110px]">پرداختی</th>
                  <th className="py-3 px-4 min-w-[110px]">مانده بدهی</th>
                  <th className="py-3 px-4 min-w-[100px] text-center">آخرین پرداخت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredRows.map((row, idx) => (
                  <tr key={row.student.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 text-center text-slate-400 font-mono">
                      {(idx + 1).toLocaleString('fa-IR')}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      <div>{row.fullName}</div>
                      {row.nationalCode && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          {row.nationalCode}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600" dir="ltr">
                      {row.phoneNumber || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-[240px] truncate" title={row.courseTitles}>
                      {row.courseTitles}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {row.totalTuition.toLocaleString('fa-IR')} تومان
                    </td>
                    <td className="py-3 px-4 font-mono text-emerald-700">
                      {row.totalPaid.toLocaleString('fa-IR')} تومان
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-rose-600">
                      {row.debt.toLocaleString('fa-IR')} تومان
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-slate-500">
                      {row.lastPaymentDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
