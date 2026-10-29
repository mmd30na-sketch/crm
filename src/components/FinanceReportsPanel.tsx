import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, X } from 'lucide-react';
import * as api from '../api/financeReports';

type Tab = 'income' | 'aging' | 'installments' | 'refunds' | 'accounting';

const statusColors: Record<api.AccountingAdapter['status'], string> = {
  ready: 'bg-green-100 text-green-800',
  needs_confirmation: 'bg-amber-100 text-amber-800',
  stub: 'bg-slate-100 text-slate-800',
};

const statusLabels: Record<api.AccountingAdapter['status'], string> = {
  ready: 'آماده',
  needs_confirmation: 'نیازمند تأیید',
  stub: 'غیرفعال',
};

const methodOptions = [
  { value: 'cash', label: 'نقد' },
  { value: 'card_transfer', label: 'کارت به کارت' },
  { value: 'bank', label: 'واریز به حساب' },
];

export default function FinanceReportsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>('income');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Common filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Income tab
  const [incomeGroup, setIncomeGroup] = useState<api.IncomeGroup>('month');
  const [incomeData, setIncomeData] = useState<api.IncomeReport | null>(null);

  // Aging tab
  const [agingAsOf, setAgingAsOf] = useState('');
  const [agingData, setAgingData] = useState<api.AgingReport | null>(null);

  // Installments tab
  const [installmentStatus, setInstallmentStatus] = useState('');
  const [installmentsData, setInstallmentsData] = useState<api.InstallmentsReport | null>(null);

  // Refunds tab
  const [refundsData, setRefundsData] = useState<api.RefundsReport | null>(null);
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [newRefund, setNewRefund] = useState({
    student_id: 0,
    enrollment_id: '',
    amount: 0,
    refund_date_jalali: '',
    method: 'cash',
    reason: '',
  });

  // Accounting tab
  const [adapters, setAdapters] = useState<api.AccountingAdapter[]>([]);
  const [settings, setSettings] = useState<api.AccountingSettings | null>(null);
  const [journalAdapter, setJournalAdapter] = useState('');
  const [journalFormat, setJournalFormat] = useState<'csv' | 'xls'>('csv');
  const [journalFrom, setJournalFrom] = useState('');
  const [journalTo, setJournalTo] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      switch (activeTab) {
        case 'income':
          const incomeParams: Record<string, string> = {};
          if (fromDate) incomeParams.from = fromDate;
          if (toDate) incomeParams.to = toDate;
          incomeParams.group = incomeGroup;
          const incomeRes = await api.incomeReport(incomeParams);
          setIncomeData(incomeRes);
          break;
        case 'aging':
          const agingParams: Record<string, string> = {};
          if (agingAsOf) agingParams.as_of = agingAsOf;
          const agingRes = await api.agingReport(agingParams);
          setAgingData(agingRes);
          break;
        case 'installments':
          const installmentsParams: Record<string, string> = {};
          if (fromDate) installmentsParams.from = fromDate;
          if (toDate) installmentsParams.to = toDate;
          if (installmentStatus) installmentsParams.status = installmentStatus;
          const installmentsRes = await api.installmentsReport(installmentsParams);
          setInstallmentsData(installmentsRes);
          break;
        case 'refunds':
          const refundsParams: Record<string, string> = {};
          if (fromDate) refundsParams.from = fromDate;
          if (toDate) refundsParams.to = toDate;
          const refundsRes = await api.refundsReport(refundsParams);
          setRefundsData(refundsRes);
          break;
        case 'accounting':
          const [adaptersRes, settingsRes] = await Promise.all([
            api.listAdapters(),
            api.getAccountingSettings(),
          ]);
          setAdapters(adaptersRes);
          setSettings(settingsRes);
          setJournalAdapter(adaptersRes.find(a => a.status !== 'stub')?.id || '');
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت داده‌ها');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'csv' | 'xls') => {
    try {
      const params: Record<string, string> = {};
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;

      switch (activeTab) {
        case 'income':
          params.group = incomeGroup;
          await api.exportReport('income', params, format);
          break;
        case 'aging':
          if (agingAsOf) params.as_of = agingAsOf;
          await api.exportReport('aging', params, format);
          break;
        case 'installments':
          if (installmentStatus) params.status = installmentStatus;
          await api.exportReport('installments', params, format);
          break;
        case 'refunds':
          await api.exportReport('refunds', params, format);
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خروجی‌گیری');
    }
  };

  const handleVoidRefund = async (id: number) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید این بازپرداخت را ابطال کنید؟')) return;
    try {
      await api.voidRefund(id);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ابطال بازپرداخت');
    }
  };

  const handleSubmitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRefund.student_id || !newRefund.amount || !newRefund.refund_date_jalali) {
      setError('لطفاً تمام فیلدهای ضروری را پر کنید');
      return;
    }

    try {
      await api.createRefund({
        ...newRefund,
        enrollment_id: newRefund.enrollment_id ? Number(newRefund.enrollment_id) : undefined,
      });
      setShowRefundForm(false);
      setNewRefund({
        student_id: 0,
        enrollment_id: '',
        amount: 0,
        refund_date_jalali: '',
        method: 'cash',
        reason: '',
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت بازپرداخت');
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    try {
      await api.saveAccountingSettings(settings);
      setError('تنظیمات با موفقیت ذخیره شد');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات');
    }
  };

  const handleExportJournal = async () => {
    if (!journalAdapter) {
      setError('لطفاً یک رابط حسابداری انتخاب کنید');
      return;
    }

    try {
      await api.exportJournal({
        adapter: journalAdapter,
        format: journalFormat,
        from: journalFrom,
        to: journalTo,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت سند حسابداری');
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, incomeGroup, installmentStatus]);

  const renderTabContent = () => {
    if (loading) return <div className="p-4 text-slate-500">در حال بارگذاری...</div>;
    if (error) return <div className="p-4 text-rose-500">{error}</div>;

    switch (activeTab) {
      case 'income':
        if (!incomeData) return null;
        const maxAmount = Math.max(...incomeData.rows.map(r => r.amount), 1);

        return (
          <div>
            {incomeData.note && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
                {incomeData.note}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">گروه</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">تعداد</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {incomeData.rows.map(row => (
                  <tr key={row.key}>
                    <td className="p-2 border-t border-slate-100">{row.label}</td>
                    <td className="p-2 border-t border-slate-100">{row.count.toLocaleString('fa-IR')}</td>
                    <td className="p-2 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="h-2 bg-sky-200 rounded-full" style={{ width: `${maxAmount ? (row.amount / maxAmount) * 100 : 0}%`, minWidth: 2 }} />
                        <span className="whitespace-nowrap">{Number(row.amount).toLocaleString('fa-IR')} تومان</span>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="p-2 border-t border-slate-200" colSpan={2}>جمع دریافتی</td>
                  <td className="p-2 border-t border-slate-200">{Number(incomeData.total).toLocaleString('fa-IR')} تومان</td>
                </tr>
                {incomeData.refunds_total !== undefined && (
                  <tr className="text-rose-700">
                    <td className="p-2 border-t border-slate-100" colSpan={2}>بازپرداخت‌ها</td>
                    <td className="p-2 border-t border-slate-100">{Number(incomeData.refunds_total).toLocaleString('fa-IR')} تومان</td>
                  </tr>
                )}
                {incomeData.net_total !== undefined && (
                  <tr className="font-bold text-emerald-700">
                    <td className="p-2 border-t border-slate-200" colSpan={2}>خالص درآمد</td>
                    <td className="p-2 border-t border-slate-200">{Number(incomeData.net_total).toLocaleString('fa-IR')} تومان</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );

      case 'aging':
        if (!agingData) return null;

        return (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {agingData.buckets.map(bucket => (
                <div key={bucket.key} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                  <div className="text-sm font-bold text-slate-900">{bucket.label}</div>
                  <div className="text-2xl font-bold mt-2">{Number(bucket.amount).toLocaleString('fa-IR')} تومان</div>
                  <div className="text-sm text-slate-500 mt-1">{bucket.count.toLocaleString('fa-IR')} مورد</div>
                </div>
              ))}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">کارآموز</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">دوره</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">تاریخ ثبت</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">مبلغ کل</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">پرداخت</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">بازپرداخت</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">مانده</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">سن (روز)</th>
                </tr>
              </thead>
              <tbody>
                {[...agingData.rows]
                  .sort((a, b) => b.age_days - a.age_days)
                  .map(row => (
                    <tr key={`${row.student_id}-${row.enrollment_id}`}>
                      <td className="p-2 border-t border-slate-100">{row.student_name}</td>
                      <td className="p-2 border-t border-slate-100">{row.course_title}</td>
                      <td className="p-2 border-t border-slate-100">{row.signup_date_jalali}</td>
                      <td className="p-2 border-t border-slate-100">{Number(row.final_price).toLocaleString('fa-IR')} تومان</td>
                      <td className="p-2 border-t border-slate-100">{Number(row.paid).toLocaleString('fa-IR')} تومان</td>
                      <td className="p-2 border-t border-slate-100">{Number(row.refunded).toLocaleString('fa-IR')} تومان</td>
                      <td className="p-2 border-t border-slate-100">{Number(row.balance).toLocaleString('fa-IR')} تومان</td>
                      <td className="p-2 border-t border-slate-100">{row.age_days.toLocaleString('fa-IR')}</td>
                    </tr>
                  ))}
                <tr className="font-bold">
                  <td className="p-2 border-t border-slate-200" colSpan={8}>
                    مجموع: {Number(agingData.total).toLocaleString('fa-IR')} تومان
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );

      case 'installments':
        if (!installmentsData) return null;

        return (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                <div className="text-sm font-bold text-slate-900">پرداخت‌نشده</div>
                <div className="text-2xl font-bold mt-2">{Number(installmentsData.summary.unpaid_amount).toLocaleString('fa-IR')} تومان</div>
                <div className="text-sm text-slate-500 mt-1">{installmentsData.summary.unpaid_count.toLocaleString('fa-IR')} مورد</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                <div className="text-sm font-bold text-slate-900">سررسید گذشته</div>
                <div className="text-2xl font-bold text-rose-600 mt-2">{Number(installmentsData.summary.overdue_amount).toLocaleString('fa-IR')} تومان</div>
                <div className="text-sm text-slate-500 mt-1">{installmentsData.summary.overdue_count.toLocaleString('fa-IR')} مورد</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                <div className="text-sm font-bold text-slate-900">پرداخت‌شده</div>
                <div className="text-2xl font-bold mt-2">{Number(installmentsData.summary.paid_amount).toLocaleString('fa-IR')} تومان</div>
                <div className="text-sm text-slate-500 mt-1">{installmentsData.summary.paid_count.toLocaleString('fa-IR')} مورد</div>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">کارآموز</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">دوره</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">مبلغ</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">تاریخ سررسید</th>
                </tr>
              </thead>
              <tbody>
                {installmentsData.rows.map(row => (
                  <tr key={row.id} className={row.overdue_days > 0 && row.status === 'unpaid' ? 'bg-rose-50' : ''}>
                    <td className="p-2 border-t border-slate-100">{row.student_name}</td>
                    <td className="p-2 border-t border-slate-100">{row.course_title}</td>
                    <td className="p-2 border-t border-slate-100">{Number(row.amount).toLocaleString('fa-IR')} تومان</td>
                    <td className="p-2 border-t border-slate-100">{row.due_date_jalali}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'refunds':
        if (!refundsData) return null;

        return (
          <div>
            {isAdmin && (
              <div className="mb-6">
                <button
                  onClick={() => setShowRefundForm(true)}
                  className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
                >
                  ثبت بازپرداخت جدید
                </button>
              </div>
            )}

            {showRefundForm && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" dir="ltr">
                <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-auto" dir="rtl">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold">ثبت بازپرداخت جدید</h2>
                    <button onClick={() => setShowRefundForm(false)} className="text-slate-500 hover:text-slate-700">
                      <X size={20} />
                    </button>
                  </div>
                  <form onSubmit={handleSubmitRefund} className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">شناسه کارآموز</label>
                      <input
                        type="number"
                        value={newRefund.student_id}
                        onChange={(e) => setNewRefund({...newRefund, student_id: Number(e.target.value)})}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">شناسه ثبت‌نام (اختیاری)</label>
                      <input
                        type="number"
                        value={newRefund.enrollment_id}
                        onChange={(e) => setNewRefund({...newRefund, enrollment_id: e.target.value})}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">مبلغ</label>
                      <input
                        type="number"
                        value={newRefund.amount}
                        onChange={(e) => setNewRefund({...newRefund, amount: Number(e.target.value)})}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">تاریخ بازپرداخت</label>
                      <input
                        type="text"
                        value={newRefund.refund_date_jalali}
                        onChange={(e) => setNewRefund({...newRefund, refund_date_jalali: e.target.value})}
                        placeholder="1405/08/07"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">روش پرداخت</label>
                      <select
                        value={newRefund.method}
                        onChange={(e) => setNewRefund({...newRefund, method: e.target.value})}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      >
                        {methodOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">دلیل</label>
                      <textarea
                        value={newRefund.reason}
                        onChange={(e) => setNewRefund({...newRefund, reason: e.target.value})}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        rows={3}
                        required
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRefundForm(false)}
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold"
                      >
                        لغو
                      </button>
                      <button
                        type="submit"
                        className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
                      >
                        ثبت بازپرداخت
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">کارآموز</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">مبلغ</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">تاریخ بازپرداخت</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">روش پرداخت</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">دلیل</th>
                  <th className="text-right text-xs text-slate-500 font-bold p-2">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {refundsData.rows.map(row => (
                  <tr key={row.id}>
                    <td className="p-2 border-t border-slate-100">{row.student_name}</td>
                    <td className="p-2 border-t border-slate-100">{Number(row.amount).toLocaleString('fa-IR')} تومان</td>
                    <td className="p-2 border-t border-slate-100">{row.refund_date_jalali}</td>
                    <td className="p-2 border-t border-slate-100">{methodOptions.find(m => m.value === row.method)?.label || row.method}</td>
                    <td className="p-2 border-t border-slate-100">{row.reason}</td>
                    <td className="p-2 border-t border-slate-100">
                      {isAdmin && row.status === 'active' && (
                        <button
                          onClick={() => handleVoidRefund(row.id)}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold"
                        >
                          ابطال
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="p-2 border-t border-slate-200" colSpan={6}>
                    مجموع: {Number(refundsData.total).toLocaleString('fa-IR')} تومان
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );

      case 'accounting':
        if (!settings || !adapters.length) return null;

        return (
          <div className="space-y-8">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-4">رابط‌های حسابداری</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {adapters.map(adapter => (
                  <div key={adapter.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{adapter.label}</div>
                        <div className={`text-xs font-bold mt-1 px-2 py-1 rounded-full ${statusColors[adapter.status]}`}>
                          {statusLabels[adapter.status]}
                        </div>
                      </div>
                    </div>
                    {adapter.notes && (
                      <div className="text-sm text-slate-600 mt-2">{adapter.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-4">تنظیمات حساب‌ها</h3>
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب صندوق</label>
                    <input
                      type="text"
                      value={settings.accounts.cash}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, cash: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب بانک</label>
                    <input
                      type="text"
                      value={settings.accounts.bank}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, bank: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب کارتخوان</label>
                    <input
                      type="text"
                      value={settings.accounts.pos}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, pos: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب درگاه آنلاین</label>
                    <input
                      type="text"
                      value={settings.accounts.online}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, online: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب‌های دریافتنی</label>
                    <input
                      type="text"
                      value={settings.accounts.receivable}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, receivable: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب درآمد</label>
                    <input
                      type="text"
                      value={settings.accounts.revenue}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, revenue: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب مالیات پرداختنی</label>
                    <input
                      type="text"
                      value={settings.accounts.vat_payable}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, vat_payable: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">حساب بازپرداخت‌ها</label>
                    <input
                      type="text"
                      value={settings.accounts.refunds}
                      onChange={(e) => setSettings({...settings, accounts: {...settings.accounts, refunds: e.target.value}})}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-bold text-slate-700 mb-1">مبنای شناسایی درآمد</label>
                  <select
                    value={settings.basis || 'cash'}
                    onChange={(e) => setSettings({ ...settings, basis: e.target.value as 'cash' | 'invoice' })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="cash">نقدی: هر دریافت = درآمد</option>
                    <option value="invoice">تعهدی: فاکتور = درآمد و مالیات؛ دریافت = تسویه بدهی کارآموز</option>
                  </select>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-bold text-slate-700 mb-1">توضیحات سند</label>
                  <textarea
                    value={settings.doc_description}
                    onChange={(e) => setSettings({...settings, doc_description: e.target.value})}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    rows={3}
                  />
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleSaveSettings}
                    className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
                  >
                    ذخیره تنظیمات
                  </button>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-4">دریافت سند حسابداری</h3>
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">رابط حسابداری</label>
                    <select
                      value={journalAdapter}
                      onChange={(e) => setJournalAdapter(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">انتخاب کنید...</option>
                      {adapters.filter(a => a.status !== 'stub').map(a => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">فرمت فایل</label>
                    <select
                      value={journalFormat}
                      onChange={(e) => setJournalFormat(e.target.value as 'csv' | 'xls')}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="csv">CSV</option>
                      <option value="xls">اکسل</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">از تاریخ</label>
                    <input
                      type="text"
                      value={journalFrom}
                      onChange={(e) => setJournalFrom(e.target.value)}
                      placeholder="1405/08/07"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">تا تاریخ</label>
                    <input
                      type="text"
                      value={journalTo}
                      onChange={(e) => setJournalTo(e.target.value)}
                      placeholder="1405/08/07"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleExportJournal}
                    className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
                  >
                    دریافت سند
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setActiveTab('income')}
          className={`px-3 py-2 rounded-lg text-sm font-bold ${activeTab === 'income' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          درآمد
        </button>
        <button
          onClick={() => setActiveTab('aging')}
          className={`px-3 py-2 rounded-lg text-sm font-bold ${activeTab === 'aging' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          سن مطالبات
        </button>
        <button
          onClick={() => setActiveTab('installments')}
          className={`px-3 py-2 rounded-lg text-sm font-bold ${activeTab === 'installments' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          اقساط
        </button>
        <button
          onClick={() => setActiveTab('refunds')}
          className={`px-3 py-2 rounded-lg text-sm font-bold ${activeTab === 'refunds' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          بازپرداخت‌ها
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('accounting')}
            className={`px-3 py-2 rounded-lg text-sm font-bold ${activeTab === 'accounting' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            خروجی حسابداری
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-bold text-slate-700 mb-1">از تاریخ</label>
          <input
            type="text"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            placeholder="1405/08/07"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-bold text-slate-700 mb-1">تا تاریخ</label>
          <input
            type="text"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            placeholder="1405/08/07"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {activeTab === 'income' && (
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-bold text-slate-700 mb-1">گروه‌بندی</label>
            <select
              value={incomeGroup}
              onChange={(e) => setIncomeGroup(e.target.value as api.IncomeGroup)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="month">ماهانه</option>
              <option value="day">روزانه</option>
              <option value="course">دوره</option>
              <option value="instructor">مربی</option>
              <option value="method">روش پرداخت</option>
            </select>
          </div>
        )}

        {activeTab === 'aging' && (
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-bold text-slate-700 mb-1">تاریخ سن</label>
            <input
              type="text"
              value={agingAsOf}
              onChange={(e) => setAgingAsOf(e.target.value)}
              placeholder="1405/08/07"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}

        {activeTab === 'installments' && (
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-bold text-slate-700 mb-1">وضعیت</label>
            <select
              value={installmentStatus}
              onChange={(e) => setInstallmentStatus(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">همه</option>
              <option value="unpaid">پرداخت‌نشده</option>
              <option value="paid">پرداخت‌شده</option>
              <option value="cancelled">لغو‌شده</option>
            </select>
          </div>
        )}

        <div className="flex items-end">
          <button
            onClick={fetchData}
            className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
          >
            نمایش
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-2 mb-4">
        <button
          onClick={() => handleExport('csv')}
          className="flex items-center gap-1 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold"
        >
          <FileText size={16} />
          CSV
        </button>
        <button
          onClick={() => handleExport('xls')}
          className="flex items-center gap-1 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold"
        >
          <FileSpreadsheet size={16} />
          اکسل
        </button>
      </div>

      {renderTabContent()}
    </div>
  );
}
