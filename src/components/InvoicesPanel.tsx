import { useState, useEffect, useMemo } from 'react';
import { Search, FilePlus, FileSpreadsheet, FileText, Printer, X, Settings, Trash2 } from 'lucide-react';
import * as api from '../api/invoices';

export default function InvoicesPanel({ isAdmin }: { isAdmin: boolean }) {
  const [invoices, setInvoices] = useState<api.Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    status: '',
    q: '',
  });
  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [currentInvoice, setCurrentInvoice] = useState<api.Invoice | null>(null);
  const [settings, setSettings] = useState<api.InvoiceSettings | null>(null);
  const [newInvoiceDraft, setNewInvoiceDraft] = useState<api.InvoiceDraft | null>(null);
  const [newInvoiceItems, setNewInvoiceItems] = useState<api.InvoiceItem[]>([]);
  const [newInvoiceDate, setNewInvoiceDate] = useState('');
  const [newInvoiceNotes, setNewInvoiceNotes] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');

  const fetchInvoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listInvoices(filters);
      setInvoices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت فاکتورها');
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const data = await api.getInvoiceSettings();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت تنظیمات');
    }
  };

  useEffect(() => {
    fetchInvoices();
    if (isAdmin) fetchSettings();
  }, [filters]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleNewInvoice = async () => {
    if (!enrollmentId) {
      setError('لطفاً شناسه ثبت‌نام را وارد کنید');
      return;
    }
    try {
      const draft = await api.draftFromEnrollment(Number(enrollmentId));
      setNewInvoiceDraft(draft);
      setNewInvoiceItems(draft.items.map(item => ({ ...item, discount: 0 })));
      setNewInvoiceDate(draft.issue_date_jalali);
      setNewInvoiceNotes(settings?.default_notes || '');
      setShowNewModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری پیش‌نویس');
    }
  };

  const handleAddItem = () => {
    setNewInvoiceItems([...newInvoiceItems, {
      description: '',
      quantity: 1,
      unit_price: 0,
      discount: 0,
    }]);
  };

  const handleRemoveItem = (index: number) => {
    setNewInvoiceItems(newInvoiceItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof api.InvoiceItem, value: string | number) => {
    const updatedItems = [...newInvoiceItems];
    updatedItems[index] = { ...updatedItems[index], [field]: Number(value) || 0 };
    setNewInvoiceItems(updatedItems);
  };

  const calculateTotals = () => {
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;

    newInvoiceItems.forEach(item => {
      const net = item.quantity * item.unit_price - item.discount;
      subtotal += item.quantity * item.unit_price;
      discountTotal += item.discount;

      if (settings?.vat_enabled) {
        const taxRate = settings.vat_rate / 100;
        const taxAmount = Math.round(settings.price_includes_vat ? net * taxRate / (1 + taxRate) : net * taxRate);
        taxTotal += taxAmount;
      }
    });

    // With VAT included in the price the tax is already inside the net amount (same rule as the server).
    const grandTotal = subtotal - discountTotal + (settings?.price_includes_vat ? 0 : taxTotal);
    return { subtotal, discountTotal, taxTotal, grandTotal };
  };

  const handleCreateInvoice = async () => {
    if (!newInvoiceDraft) return;

    try {
      const invoice = await api.createInvoice({
        student_id: newInvoiceDraft.student_id,
        enrollment_id: newInvoiceDraft.enrollment_id,
        issue_date_jalali: newInvoiceDate,
        items: newInvoiceItems,
        notes: newInvoiceNotes,
      });
      setShowNewModal(false);
      setCurrentInvoice(await api.getInvoice(invoice.id));
      setShowPrintModal(true);
      fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در صدور فاکتور');
    }
  };

  const handleCancelInvoice = async (id: number) => {
    const reason = window.prompt('دلیل ابطال فاکتور را وارد کنید:');
    if (!reason) return;

    if (!window.confirm('آیا از ابطال این فاکتور مطمئن هستید؟')) return;

    try {
      await api.cancelInvoice(id, reason);
      fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ابطال فاکتور');
    }
  };

  const handleExport = async (format: 'csv' | 'xls') => {
    try {
      await api.exportInvoices(filters, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خروجی فایل');
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;

    try {
      await api.saveInvoiceSettings(settings);
      setShowSettingsModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات');
    }
  };

  const totals = useMemo(() => calculateTotals(), [newInvoiceItems, settings]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-700">از تاریخ:</label>
            <input
              type="text"
              name="from"
              value={filters.from}
              onChange={handleFilterChange}
              placeholder="1405/08/07"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-32"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-700">تا تاریخ:</label>
            <input
              type="text"
              name="to"
              value={filters.to}
              onChange={handleFilterChange}
              placeholder="1405/08/07"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-32"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-700">وضعیت:</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">همه</option>
              <option value="issued">صادرشده</option>
              <option value="cancelled">باطل‌شده</option>
            </select>
          </div>
          <div className="flex items-center gap-2 flex-grow">
            <div className="relative flex-grow">
              <input
                type="text"
                name="q"
                value={filters.q}
                onChange={handleFilterChange}
                placeholder="جستجو..."
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full pr-10"
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-2"
          >
            <FilePlus className="h-4 w-4" />
            فاکتور جدید
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" />
            خروجی CSV
          </button>
          <button
            onClick={() => handleExport('xls')}
            className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-2"
          >
            <FileText className="h-4 w-4" />
            خروجی اکسل
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowSettingsModal(true)}
              className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              تنظیمات فاکتور
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-right text-xs text-slate-500 font-bold p-2">شماره فاکتور</th>
              <th className="text-right text-xs text-slate-500 font-bold p-2">تاریخ</th>
              <th className="text-right text-xs text-slate-500 font-bold p-2">خریدار</th>
              <th className="text-right text-xs text-slate-500 font-bold p-2">مبلغ کل</th>
              <th className="text-right text-xs text-slate-500 font-bold p-2">مالیات</th>
              <th className="text-right text-xs text-slate-500 font-bold p-2">وضعیت</th>
              <th className="text-right text-xs text-slate-500 font-bold p-2">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-500">
                  در حال بارگذاری...
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-500">
                  فاکتوری یافت نشد
                </td>
              </tr>
            ) : (
              invoices.map(invoice => (
                <tr key={invoice.id} className="hover:bg-slate-50">
                  <td className="p-2 border-t border-slate-100">{invoice.invoice_no}</td>
                  <td className="p-2 border-t border-slate-100">{invoice.issue_date_jalali}</td>
                  <td className="p-2 border-t border-slate-100">{invoice.buyer.full_name}</td>
                  <td className="p-2 border-t border-slate-100">
                    {Number(invoice.grand_total).toLocaleString('fa-IR')} تومان
                  </td>
                  <td className="p-2 border-t border-slate-100">
                    {Number(invoice.tax_total).toLocaleString('fa-IR')} تومان
                  </td>
                  <td className="p-2 border-t border-slate-100">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                      invoice.status === 'issued' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {invoice.status === 'issued' ? 'صادرشده' : 'باطل‌شده'}
                    </span>
                  </td>
                  <td className="p-2 border-t border-slate-100 flex gap-2">
                    <button
                      onClick={async () => {
                        // The list has no line items: load the full invoice before printing.
                        try {
                          setCurrentInvoice(await api.getInvoice(invoice.id));
                          setShowPrintModal(true);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'خطا در بارگذاری فاکتور');
                        }
                      }}
                      title="مشاهده / چاپ"
                      aria-label="مشاهده / چاپ"
                      className="text-sky-600 hover:text-sky-800"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    {invoice.status === 'issued' && (
                      <button
                        onClick={() => handleCancelInvoice(invoice.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showNewModal && newInvoiceDraft && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">فاکتور جدید</h2>
              <button onClick={() => setShowNewModal(false)} className="text-slate-500 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">شناسه ثبت‌نام</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={enrollmentId}
                      onChange={(e) => setEnrollmentId(e.target.value)}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-grow"
                    />
                    <button
                      onClick={handleNewInvoice}
                      className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
                    >
                      بارگذاری
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تاریخ صدور</label>
                  <input
                    type="text"
                    value={newInvoiceDate}
                    onChange={(e) => setNewInvoiceDate(e.target.value)}
                    placeholder="1405/08/07"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-700">مشخصات خریدار</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500">نام و نام خانوادگی</label>
                    <div className="text-sm">{newInvoiceDraft.buyer.full_name}</div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">کد ملی</label>
                    <div className="text-sm">{newInvoiceDraft.buyer.national_code}</div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">نام پدر</label>
                    <div className="text-sm">{newInvoiceDraft.buyer.father_name}</div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">تلفن</label>
                    <div className="text-sm">{newInvoiceDraft.buyer.phone}</div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-slate-500">آدرس</label>
                    <div className="text-sm">{newInvoiceDraft.buyer.address}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-700">آیتم‌های فاکتور</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-right text-xs text-slate-500 font-bold p-2">شرح</th>
                        <th className="text-right text-xs text-slate-500 font-bold p-2">تعداد</th>
                        <th className="text-right text-xs text-slate-500 font-bold p-2">مبلغ واحد</th>
                        <th className="text-right text-xs text-slate-500 font-bold p-2">تخفیف</th>
                        <th className="text-right text-xs text-slate-500 font-bold p-2">مبلغ کل</th>
                        <th className="text-right text-xs text-slate-500 font-bold p-2">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newInvoiceItems.map((item, index) => (
                        <tr key={index}>
                          <td className="p-2 border-t border-slate-100">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                              className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-full"
                            />
                          </td>
                          <td className="p-2 border-t border-slate-100">
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                              className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-20"
                            />
                          </td>
                          <td className="p-2 border-t border-slate-100">
                            <input
                              type="number"
                              value={item.unit_price}
                              onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                              className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-24"
                            />
                          </td>
                          <td className="p-2 border-t border-slate-100">
                            <input
                              type="number"
                              value={item.discount}
                              onChange={(e) => handleItemChange(index, 'discount', e.target.value)}
                              className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-24"
                            />
                          </td>
                          <td className="p-2 border-t border-slate-100">
                            {Number(item.quantity * item.unit_price - item.discount).toLocaleString('fa-IR')} تومان
                          </td>
                          <td className="p-2 border-t border-slate-100">
                            <button
                              onClick={() => handleRemoveItem(index)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={handleAddItem}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-2 text-sm font-bold mt-2"
                >
                  افزودن آیتم
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">توضیحات</label>
                  <textarea
                    value={newInvoiceNotes}
                    onChange={(e) => setNewInvoiceNotes(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full h-24"
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-700">مجموع</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>جمع کل:</span>
                      <span>{Number(totals.subtotal).toLocaleString('fa-IR')} تومان</span>
                    </div>
                    <div className="flex justify-between">
                      <span>تخفیف:</span>
                      <span>{Number(totals.discountTotal).toLocaleString('fa-IR')} تومان</span>
                    </div>
                    <div className="flex justify-between">
                      <span>مالیات:</span>
                      <span>{Number(totals.taxTotal).toLocaleString('fa-IR')} تومان</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900">
                      <span>مبلغ قابل پرداخت:</span>
                      <span>{Number(totals.grandTotal).toLocaleString('fa-IR')} تومان</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  onClick={() => setShowNewModal(false)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  لغو
                </button>
                <button
                  onClick={handleCreateInvoice}
                  className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
                >
                  صدور فاکتور
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && settings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">تنظیمات فاکتور</h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-500 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">نام حقوقی فروشنده</label>
                  <input
                    type="text"
                    value={settings.seller.legal_name}
                    onChange={(e) => setSettings({ ...settings, seller: { ...settings.seller, legal_name: e.target.value } })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">کد اقتصادی</label>
                  <input
                    type="text"
                    value={settings.seller.economic_code}
                    onChange={(e) => setSettings({ ...settings, seller: { ...settings.seller, economic_code: e.target.value } })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">شناسه ملی</label>
                  <input
                    type="text"
                    value={settings.seller.national_id}
                    onChange={(e) => setSettings({ ...settings, seller: { ...settings.seller, national_id: e.target.value } })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">شماره ثبت</label>
                  <input
                    type="text"
                    value={settings.seller.registration_no}
                    onChange={(e) => setSettings({ ...settings, seller: { ...settings.seller, registration_no: e.target.value } })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">کد پستی</label>
                  <input
                    type="text"
                    value={settings.seller.postal_code}
                    onChange={(e) => setSettings({ ...settings, seller: { ...settings.seller, postal_code: e.target.value } })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">نشانی</label>
                  <input
                    type="text"
                    value={settings.seller.address}
                    onChange={(e) => setSettings({ ...settings, seller: { ...settings.seller, address: e.target.value } })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تلفن</label>
                  <input
                    type="text"
                    value={settings.seller.phone}
                    onChange={(e) => setSettings({ ...settings, seller: { ...settings.seller, phone: e.target.value } })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">پیشوند شماره فاکتور</label>
                  <input
                    type="text"
                    value={settings.prefix}
                    onChange={(e) => setSettings({ ...settings, prefix: e.target.value })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={settings.vat_enabled}
                      onChange={(e) => setSettings({ ...settings, vat_enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    اعمال مالیات بر ارزش افزوده
                  </label>
                  <div className="text-xs text-slate-500">
                    خدمات آموزشی ممکن است معاف از مالیات باشند؛ با مشاور مالیاتی تأیید کنید.
                  </div>
                </div>
                {settings.vat_enabled && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">درصد مالیات</label>
                      <input
                        type="number"
                        value={settings.vat_rate}
                        onChange={(e) => setSettings({ ...settings, vat_rate: Number(e.target.value) })}
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={settings.price_includes_vat}
                          onChange={(e) => setSettings({ ...settings, price_includes_vat: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        قیمت‌ها شامل مالیات است
                      </label>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">توضیحات پیش‌فرض</label>
                <textarea
                  value={settings.default_notes}
                  onChange={(e) => setSettings({ ...settings, default_notes: e.target.value })}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full h-24"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">متن فوتر</label>
                <textarea
                  value={settings.footer_text}
                  onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full h-24"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  لغو
                </button>
                <button
                  onClick={handleSaveSettings}
                  className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold"
                >
                  ذخیره تنظیمات
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPrintModal && currentInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">چاپ فاکتور</h2>
              <button onClick={() => setShowPrintModal(false)} className="text-slate-500 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <InvoicePrint invoice={currentInvoice} />
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  onClick={() => setShowPrintModal(false)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  بستن
                </button>
                <button
                  onClick={() => window.print()}
                  className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  چاپ / PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function InvoicePrint({ invoice }: { invoice: api.Invoice }) {
  return (
    <div id="invoice-print" dir="rtl" className="bg-white p-8 font-sans text-black relative">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #invoice-print, #invoice-print * {
            visibility: visible;
          }
          #invoice-print {
            position: absolute;
            inset: 0;
          }
          .no-print {
            display: none !important;
          }
        }
        @page {
          size: A4;
          margin: 12mm;
        }
      `}</style>

      {invoice.status === 'cancelled' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-red-500 text-6xl font-bold transform rotate-12 opacity-30">
            باطل شد
          </div>
        </div>
      )}

      <div className="text-center mb-8">
        <h1 className="text-xl font-bold">صورتحساب فروش کالا و خدمات</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div>
          <div className="font-bold mb-2">شماره فاکتور:</div>
          <div>{invoice.invoice_no}</div>
        </div>
        <div>
          <div className="font-bold mb-2">تاریخ:</div>
          <div>{invoice.issue_date_jalali}</div>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="font-bold mb-2">مشخصات فروشنده</h2>
        <div className="grid grid-cols-2 gap-4 border border-slate-300 p-4 rounded-lg">
          <div>
            <div className="font-bold">نام حقوقی:</div>
            <div>{invoice.seller.legal_name}</div>
          </div>
          <div>
            <div className="font-bold">کد اقتصادی:</div>
            <div>{invoice.seller.economic_code}</div>
          </div>
          <div>
            <div className="font-bold">شناسه ملی:</div>
            <div>{invoice.seller.national_id}</div>
          </div>
          <div>
            <div className="font-bold">شماره ثبت:</div>
            <div>{invoice.seller.registration_no}</div>
          </div>
          <div>
            <div className="font-bold">کد پستی:</div>
            <div>{invoice.seller.postal_code}</div>
          </div>
          <div>
            <div className="font-bold">نشانی:</div>
            <div>{invoice.seller.address}</div>
          </div>
          <div>
            <div className="font-bold">تلفن:</div>
            <div>{invoice.seller.phone}</div>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="font-bold mb-2">مشخصات خریدار</h2>
        <div className="grid grid-cols-2 gap-4 border border-slate-300 p-4 rounded-lg">
          <div>
            <div className="font-bold">نام و نام خانوادگی:</div>
            <div>{invoice.buyer.full_name}</div>
          </div>
          <div>
            <div className="font-bold">کد ملی:</div>
            <div>{invoice.buyer.national_code}</div>
          </div>
          <div>
            <div className="font-bold">نام پدر:</div>
            <div>{invoice.buyer.father_name}</div>
          </div>
          <div>
            <div className="font-bold">تلفن:</div>
            <div>{invoice.buyer.phone}</div>
          </div>
          <div className="col-span-2">
            <div className="font-bold">آدرس:</div>
            <div>{invoice.buyer.address}</div>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="font-bold mb-2">آیتم‌های فاکتور</h2>
        <table className="w-full border-collapse border border-slate-300">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 p-2">ردیف</th>
              <th className="border border-slate-300 p-2">شرح کالا/خدمت</th>
              <th className="border border-slate-300 p-2">تعداد</th>
              <th className="border border-slate-300 p-2">مبلغ واحد (تومان)</th>
              <th className="border border-slate-300 p-2">مبلغ کل</th>
              <th className="border border-slate-300 p-2">تخفیف</th>
              <th className="border border-slate-300 p-2">مبلغ پس از تخفیف</th>
              <th className="border border-slate-300 p-2">مالیات و عوارض</th>
              <th className="border border-slate-300 p-2">جمع کل</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => (
              <tr key={index}>
                <td className="border border-slate-300 p-2 text-center">{index + 1}</td>
                <td className="border border-slate-300 p-2">{item.description}</td>
                <td className="border border-slate-300 p-2 text-center">{item.quantity}</td>
                <td className="border border-slate-300 p-2 text-right">
                  {Number(item.unit_price).toLocaleString('fa-IR')}
                </td>
                <td className="border border-slate-300 p-2 text-right">
                  {Number(item.quantity * item.unit_price).toLocaleString('fa-IR')}
                </td>
                <td className="border border-slate-300 p-2 text-right">
                  {Number(item.discount).toLocaleString('fa-IR')}
                </td>
                <td className="border border-slate-300 p-2 text-right">
                  {Number(item.quantity * item.unit_price - item.discount).toLocaleString('fa-IR')}
                </td>
                <td className="border border-slate-300 p-2 text-right">
                  {Number(item.tax_amount || 0).toLocaleString('fa-IR')}
                </td>
                <td className="border border-slate-300 p-2 text-right">
                  {Number(item.total || 0).toLocaleString('fa-IR')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="border border-slate-300 p-2 font-bold">جمع کل</td>
              <td className="border border-slate-300 p-2 text-right font-bold">
                {Number(invoice.subtotal).toLocaleString('fa-IR')}
              </td>
              <td className="border border-slate-300 p-2 text-right font-bold">
                {Number(invoice.discount_total).toLocaleString('fa-IR')}
              </td>
              <td className="border border-slate-300 p-2 text-right font-bold">
                {Number(invoice.tax_total).toLocaleString('fa-IR')}
              </td>
              <td className="border border-slate-300 p-2 text-right font-bold">
                {Number(invoice.grand_total).toLocaleString('fa-IR')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {invoice.notes && (
        <div className="mb-8">
          <h2 className="font-bold mb-2">توضیحات</h2>
          <div className="border border-slate-300 p-4 rounded-lg">{invoice.notes}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div className="border border-slate-300 p-4 rounded-lg h-32">
          <div className="font-bold mb-2">مهر و امضای فروشنده</div>
        </div>
        <div className="border border-slate-300 p-4 rounded-lg h-32">
          <div className="font-bold mb-2">امضای خریدار</div>
        </div>
      </div>

      {invoice.status === 'cancelled' && (
        <div className="text-center text-red-600 font-bold mb-4">
          این فاکتور باطل شده است. دلیل: {invoice.cancel_reason}
        </div>
      )}

      <div className="text-center text-sm text-slate-600">
        {invoice.footer_text}
      </div>
    </div>
  );
}
