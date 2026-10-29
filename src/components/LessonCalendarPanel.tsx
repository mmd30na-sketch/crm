import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, RefreshCw, ChevronRight, ChevronLeft, Plus, Edit3, Trash2, X, Loader2, CalendarDays, Car, User, Clock, AlertTriangle } from 'lucide-react';
import * as api from '../api/lessons';
import { jalaliTodayParts, jalaliToday } from '../utils/normalize';
import { JALALI_MONTH_NAMES } from '../utils/charts';
import { weekDates, jalaliWeekday, timeToMinutes } from '../../lessonCore';
import { addJalaliDays } from '../utils/jalali';
import ModalPortal from './ModalPortal';

const fa = (n: number) => (Number(n) || 0).toLocaleString('fa-IR');
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200';

type Tab = 'calendar' | 'vehicles' | 'availability' | 'reminders';
const TABS: { id: Tab; label: string; icon: typeof CalendarClock }[] = [
  { id: 'calendar', label: 'تقویم', icon: CalendarClock },
  { id: 'vehicles', label: 'خودروها', icon: Car },
  { id: 'availability', label: 'ساعات حضور مربیان', icon: User },
  { id: 'reminders', label: 'یادآور پیامکی', icon: AlertTriangle },
];

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // rows 07:00 .. 21:00 (the last row ends at 22:00)
const HOUR_PX = 60;
const DAY_START_MIN = 7 * 60;
const maskPhone = (v: unknown) => {
  const d = String(v ?? '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0)).replace(/\D/g, '');
  return d.length >= 10 ? `0${d.slice(-10, -7)}***${d.slice(-2)}` : '';
};

export default function LessonCalendarPanel({ students, isAdmin }: { students: { id: number; first_name: string; last_name: string; phone_number?: string }[]; isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>('calendar');
  const [err, setErr] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Calendar state
  const [view, setView] = useState<'week' | 'day'>('week');
  const [currentDate, setCurrentDate] = useState(jalaliToday());
  const [filterInstructor, setFilterInstructor] = useState<number | undefined>();
  const [filterVehicle, setFilterVehicle] = useState<number | undefined>();
  const [bookings, setBookings] = useState<api.Booking[]>([]);
  const [vehicles, setVehicles] = useState<api.Vehicle[]>([]);
  const [instructors, setInstructors] = useState<api.LessonInstructor[]>([]);
  const [availability, setAvailability] = useState<api.Availability[]>([]);
  const [reminderConfig, setReminderConfig] = useState<api.ReminderConfig | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [modalData, setModalData] = useState<Partial<api.BookingInput & { id?: number; status?: api.BookingStatus }>>({});
  const [modalErrors, setModalErrors] = useState<Record<string, string>>({});
  const [modalConflicts, setModalConflicts] = useState<api.Conflict[]>([]);
  const [modalWarnings, setModalWarnings] = useState<string[]>([]);
  const [forceOutsideAvailability, setForceOutsideAvailability] = useState(false);

  // Student search
  const [studentSearch, setStudentSearch] = useState('');
  const filteredStudents = useMemo(() => {
    if (!studentSearch) return [];
    const norm = (v: string) => v.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0)).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, '').toLowerCase();
    const key = norm(studentSearch);
    return students.filter(s =>
      norm(`${s.first_name}${s.last_name}${s.phone_number || ''}${s.id}`).includes(key)
    ).slice(0, 8);
  }, [students, studentSearch]);

  // Sub-tab state lives here (hooks must not be called inside the render helpers below).
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [vehicleData, setVehicleData] = useState<Partial<api.Vehicle>>({});
  const [vehicleErrors, setVehicleErrors] = useState<Record<string, string>>({});
  const [selectedInstructor, setSelectedInstructor] = useState<number | undefined>();
  const [newAvailability, setNewAvailability] = useState<Omit<api.Availability, 'id'>>({
    instructor_id: 0,
    weekday: 0,
    start_time: '09:00',
    end_time: '17:00',
  });

  const filteredAvailability = useMemo(() => {
    return availability.filter(a => !selectedInstructor || a.instructor_id === selectedInstructor);
  }, [availability, selectedInstructor]);
  const [previewCandidates, setPreviewCandidates] = useState<{ booking_id: number; student_name: string; phone_masked: string; lesson_date: string; start_time: string }[]>([]);
  const [notice, setNotice] = useState('');
  const [needsForce, setNeedsForce] = useState(false);
  const [logSession, setLogSession] = useState(true);
  useEffect(() => {
    if (!isAdmin || tab !== 'reminders') return;
    api.getReminderConfig().then(setReminderConfig).catch((e) => setErr((e as Error).message || 'خطا در بارگذاری تنظیمات یادآور'));
  }, [isAdmin, tab]);

  const refresh = async () => {
    setLoading(true);
    setErr('');
    try {
      const [bookings, vehicles, instructors, availability] = await Promise.all([
        api.listBookings({
          from: view === 'week' ? weekDates(currentDate)[0] : currentDate,
          to: view === 'week' ? weekDates(currentDate)[6] : currentDate,
          instructor_id: filterInstructor,
          vehicle_id: filterVehicle,
        }),
        api.listVehicles(),
        api.listInstructors(),
        api.listAvailability(),
      ]);
      setBookings(bookings);
      setVehicles(vehicles);
      setInstructors(instructors);
      setAvailability(availability);
    } catch (e) {
      setErr((e as Error).message || 'خطا در بارگذاری داده‌ها');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [currentDate, view, filterInstructor, filterVehicle]);

  const handleDateChange = (days: number) => {
    setCurrentDate(addJalaliDays(currentDate, days));
  };

  const getWeekRange = () => {
    const dates = weekDates(currentDate);
    const [start, end] = [dates[0], dates[6]];
    const [sy, sm, sd] = start.split('/').map(Number);
    const [ey, em, ed] = end.split('/').map(Number);
    void sy;
    return `${fa(sd)} ${JALALI_MONTH_NAMES[sm - 1]} تا ${fa(ed)} ${JALALI_MONTH_NAMES[em - 1]} ${String(ey).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)])}`;
  };

  const getDayLabel = (date: string) => {
    const [, m, d] = date.split('/').map(Number);
    const weekday = jalaliWeekday(date) ?? 0;
    return `${api.WEEKDAY_LABELS[weekday]} ${fa(d)} ${JALALI_MONTH_NAMES[m - 1]}`;
  };

  const getTimeLabel = (start: string, end: string) => {
    return `${start}–${end}`;
  };

  const getStatusColor = (status: api.BookingStatus) => {
    switch (status) {
      case 'scheduled': return 'bg-sky-100 border-sky-200 text-sky-800';
      case 'done': return 'bg-emerald-100 border-emerald-200 text-emerald-800';
      case 'no_show': return 'bg-amber-100 border-amber-200 text-amber-800';
      case 'cancelled': return 'bg-slate-100 border-slate-200 text-slate-500';
    }
  };

  const openCreateModal = (date: string, hour: number) => {
    const startTime = `${hour.toString().padStart(2, '0')}:00`;
    const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;

    setModalMode('create');
    setModalData({
      lesson_date: date,
      start_time: startTime,
      end_time: endTime,
    });
    setModalErrors({});
    setModalConflicts([]);
    setModalWarnings([]);
    setForceOutsideAvailability(false);
    setNeedsForce(false);
    setLogSession(true);
    setStudentSearch('');
    setShowModal(true);
  };

  const openEditModal = (booking: api.Booking) => {
    setModalMode('edit');
    setModalData({
      id: booking.id,
      student_id: booking.student_id,
      instructor_id: booking.instructor_id,
      vehicle_id: booking.vehicle_id,
      lesson_date: booking.lesson_date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      status: booking.status,
      notes: booking.notes,
    });
    setModalErrors({});
    setModalConflicts([]);
    setModalWarnings([]);
    setForceOutsideAvailability(false);
    setNeedsForce(false);
    setLogSession(true);
    setStudentSearch('');
    setShowModal(true);
  };

  const handleModalSubmit = async () => {
    setModalErrors({});
    setModalConflicts([]);
    setModalWarnings([]);

    const errors: Record<string, string> = {};
    if (!modalData.student_id) errors.student_id = 'هنرجو را انتخاب کنید';
    if (!modalData.instructor_id) errors.instructor_id = 'مربی را انتخاب کنید';
    if (!modalData.lesson_date) errors.lesson_date = 'تاریخ را وارد کنید';
    if (!modalData.start_time) errors.start_time = 'ساعت شروع را وارد کنید';
    if (!modalData.end_time) errors.end_time = 'ساعت پایان را وارد کنید';

    if (Object.keys(errors).length > 0) {
      setModalErrors(errors);
      return;
    }

    try {
      if (modalMode === 'create') {
        const { id, warnings } = await api.createBooking({
          ...modalData as api.BookingInput,
          force_outside_availability: forceOutsideAvailability,
        });
        void id;
        if (warnings?.length) setNotice(warnings.join('، '));
      } else {
        const { warnings } = await api.updateBooking(modalData.id!, {
          ...modalData as api.BookingInput,
          force_outside_availability: forceOutsideAvailability,
        });
        if (warnings?.length) setNotice(warnings.join('، '));
      }

      setShowModal(false);
      refresh();
    } catch (e: any) {
      if (e.status === 409) {
        setModalConflicts(e.data.conflicts || []);
      } else if (e.status === 400 && e.data?.outside_availability) {
        setNeedsForce(true);
        setModalErrors({ general: 'ساعت انتخاب‌شده خارج از ساعات حضور مربی است. برای ثبت، گزینه زیر را تأیید کنید.' });
      } else {
        setModalErrors({ general: e.message || 'خطا در ذخیره‌سازی' });
      }
    }
  };

  const handleStatusChange = async (status: api.BookingStatus, logSession?: boolean) => {
    if (!modalData.id) return;

    try {
      await api.updateBookingStatus(modalData.id, status, logSession);
      setShowModal(false);
      refresh();
    } catch (e) {
      setModalErrors({ general: (e as Error).message || 'خطا در تغییر وضعیت' });
    }
  };

  const handleCancel = async () => {
    if (!modalData.id) return;

    const reason = prompt('دلیل لغو جلسه را وارد کنید:');
    if (reason === null) return;

    try {
      await api.cancelBooking(modalData.id, reason);
      setShowModal(false);
      refresh();
    } catch (e) {
      setModalErrors({ general: (e as Error).message || 'خطا در لغو جلسه' });
    }
  };

  const handleReminderPreview = async () => {
    if (!isAdmin) return;

    try {
      const result = await api.runReminders(true);
      alert(`پیش‌نمایش ارسال:\n${result.candidates.length} جلسه برای ارسال انتخاب شد`);
    } catch (e) {
      setErr((e as Error).message || 'خطا در پیش‌نمایش ارسال');
    }
  };

  const handleReminderSend = async () => {
    if (!isAdmin || !reminderConfig?.enabled) return;

    if (!window.confirm('آیا مطمئن هستید که می‌خواهید ارسال واقعی انجام دهید؟')) return;

    try {
      const result = await api.runReminders(false);
      alert(`ارسال انجام شد:\n${result.sent} پیام ارسال شد\n${result.failed} پیام با خطا مواجه شد`);
    } catch (e) {
      setErr((e as Error).message || 'خطا در ارسال پیامکی');
    }
  };

  const renderCalendar = () => {
    const dates = view === 'week' ? weekDates(currentDate) : [currentDate];
    const today = jalaliToday();

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800">تقویم جلسات عملی</h2>
              <p className="text-xs text-slate-500">رزرو مربی و خودرو، جابه‌جایی و لغو</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setView(view === 'week' ? 'day' : 'week')} className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
              {view === 'week' ? 'روز' : 'هفته'}
            </button>
            <button onClick={() => handleDateChange(-(view === 'week' ? 7 : 1))} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => setCurrentDate(today)} className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
              امروز
            </button>
            <button onClick={() => handleDateChange(view === 'week' ? 7 : 1)} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[160px]">
            <select
              value={filterInstructor || ''}
              onChange={(e) => setFilterInstructor(e.target.value ? Number(e.target.value) : undefined)}
              className={inputCls}
            >
              <option value="">همه مربیان</option>
              {instructors.filter(i => i.active).map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <select
              value={filterVehicle || ''}
              onChange={(e) => setFilterVehicle(e.target.value ? Number(e.target.value) : undefined)}
              className={inputCls}
            >
              <option value="">همه خودروها</option>
              {vehicles.filter(v => v.active).map(v => (
                <option key={v.id} value={v.id}>{v.name} {v.plate ? `(${v.plate})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-sm text-slate-600 bg-white border border-slate-200 rounded-2xl px-4 py-2">
          {view === 'week' ? getWeekRange() : getDayLabel(currentDate)}
        </div>

        <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className={view === 'week' ? 'min-w-[760px]' : ''}>
            <div className="flex">
              {/* hour gutter (right side in RTL) */}
              <div className="w-12 shrink-0 border-l border-slate-100">
                <div className="h-9 border-b border-slate-100" />
                {HOURS.map((h) => (
                  <div key={h} className="h-[60px] text-[10px] text-slate-400 text-center pt-0.5 border-t border-slate-100 font-mono" dir="ltr">{String(h).padStart(2, '0')}:00</div>
                ))}
              </div>
              {dates.map((date) => {
                const isToday = date === today;
                const dayBookings = bookings.filter((b) => b.lesson_date === date);
                return (
                  <div key={date} className={`flex-1 min-w-0 border-l border-slate-100 ${isToday ? 'bg-sky-50/40' : ''}`}>
                    <div className={`h-9 flex items-center justify-center text-[11px] font-bold border-b border-slate-100 ${isToday ? 'text-sky-700' : 'text-slate-600'}`}>
                      {getDayLabel(date)}
                    </div>
                    <div className="relative" style={{ height: HOURS.length * HOUR_PX }}>
                      {HOURS.map((hour) => (
                        <button
                          key={hour}
                          type="button"
                          aria-label={`رزرو جدید ${getDayLabel(date)} ساعت ${hour}`}
                          onClick={() => openCreateModal(date, hour)}
                          className="block w-full h-[60px] border-t border-slate-100 hover:bg-sky-50/70 focus:outline-none focus:bg-sky-50"
                        />
                      ))}
                      {dayBookings.map((booking) => {
                        const startMin = timeToMinutes(booking.start_time);
                        const endMin = timeToMinutes(booking.end_time);
                        const top = Math.max(0, (startMin - DAY_START_MIN) * (HOUR_PX / 60));
                        const height = Math.max(20, (endMin - Math.max(startMin, DAY_START_MIN)) * (HOUR_PX / 60) - 2);
                        return (
                          <button
                            type="button"
                            key={booking.id}
                            className={`absolute right-0.5 left-0.5 z-10 rounded-lg border text-right overflow-hidden shadow-sm hover:ring-2 hover:ring-sky-300 ${getStatusColor(booking.status)}`}
                            style={{ top, height }}
                            onClick={() => openEditModal(booking)}
                            title={[booking.student_name, booking.instructor_name, booking.vehicle_name, booking.notes].filter(Boolean).join(' — ')}
                          >
                            <div className="p-1 text-[10px] leading-tight">
                              <div className="font-bold font-mono" dir="ltr">{getTimeLabel(booking.start_time, booking.end_time)}</div>
                              <div className="font-bold truncate">{booking.student_name}</div>
                              <div className="opacity-75 truncate">{booking.instructor_name}{booking.vehicle_name ? ` | ${booking.vehicle_name}` : ''}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {loading && <div className="text-xs text-slate-400 text-center flex items-center justify-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...</div>}
      </div>
    );
  };

  const renderVehicles = () => {

    const handleVehicleSubmit = async () => {
      setVehicleErrors({});
      const errors: Record<string, string> = {};
      if (!vehicleData.name) errors.name = 'نام خودرو را وارد کنید';

      if (Object.keys(errors).length > 0) {
        setVehicleErrors(errors);
        return;
      }

      try {
        if (vehicleData.id) {
          await api.updateVehicle(vehicleData.id, vehicleData);
        } else {
          await api.createVehicle(vehicleData as Omit<api.Vehicle, 'id'>);
        }
        setShowVehicleModal(false);
        refresh();
      } catch (e) {
        setVehicleErrors({ general: (e as Error).message || 'خطا در ذخیره‌سازی' });
      }
    };

    const handleVehicleDelete = async (id: number) => {
      if (!window.confirm('آیا مطمئن هستید که می‌خواهید این خودرو را حذف کنید؟')) return;

      try {
        await api.deleteVehicle(id);
        refresh();
      } catch (e) {
        setErr((e as Error).message || 'خطا در حذف خودرو');
      }
    };

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800">خودروها</h2>
              <p className="text-xs text-slate-500">مدیریت خودروهای آموزشی</p>
            </div>
          </div>
          <button onClick={refresh} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

        <div className="flex justify-end">
          <button onClick={() => { setVehicleData({ active: true }); setShowVehicleModal(true); }} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl">
            <Plus className="w-4 h-4" />خودرو جدید
          </button>
        </div>

        {loading ? (
          <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-1.5">
            <Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...
          </div>
        ) : vehicles.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-8 text-center">خودرویی ثبت نشده است.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {['نام', 'پلاک', 'نوع', 'گیربکس', 'وضعیت', 'یادداشت', ''].map(h => (
                    <th key={h} className="px-3 py-2.5 font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => (
                  <tr key={v.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                    <td className="px-3 py-2.5 font-bold text-slate-800">{v.name}</td>
                    <td className="px-3 py-2.5">{v.plate || '—'}</td>
                    <td className="px-3 py-2.5">{api.VEHICLE_KIND_LABEL[v.kind]}</td>
                    <td className="px-3 py-2.5">{v.gearbox === 'manual' ? 'دستی' : v.gearbox === 'automatic' ? 'خودکار' : '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${v.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {v.active ? 'فعال' : 'غیرفعال'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[240px] truncate">{v.notes || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setVehicleData(v); setShowVehicleModal(true); }} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="ویرایش">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleVehicleDelete(v.id)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" aria-label="حذف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showVehicleModal && (
          <ModalPortal>
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-4 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-800">{vehicleData.id ? 'ویرایش خودرو' : 'خودرو جدید'}</h3>
                  <button onClick={() => setShowVehicleModal(false)} className="p-1 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="بستن">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  {vehicleErrors.general && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{vehicleErrors.general}</p>}

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">نام خودرو</label>
                    <input
                      type="text"
                      value={vehicleData.name || ''}
                      onChange={(e) => setVehicleData({ ...vehicleData, name: e.target.value })}
                      className={`${inputCls} ${vehicleErrors.name ? 'border-rose-200 focus:ring-rose-200' : ''}`}
                    />
                    {vehicleErrors.name && <p className="text-[11px] text-rose-600 mt-1">{vehicleErrors.name}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">پلاک</label>
                    <input
                      type="text"
                      value={vehicleData.plate || ''}
                      onChange={(e) => setVehicleData({ ...vehicleData, plate: e.target.value })}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">نوع</label>
                    <select
                      value={vehicleData.kind || 'car'}
                      onChange={(e) => setVehicleData({ ...vehicleData, kind: e.target.value as api.Vehicle['kind'] })}
                      className={inputCls}
                    >
                      {Object.entries(api.VEHICLE_KIND_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">گیربکس</label>
                    <select
                      value={vehicleData.gearbox || ''}
                      onChange={(e) => setVehicleData({ ...vehicleData, gearbox: e.target.value as api.Vehicle['gearbox'] })}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      <option value="manual">دستی</option>
                      <option value="automatic">خودکار</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="vehicle-active"
                      checked={vehicleData.active || false}
                      onChange={(e) => setVehicleData({ ...vehicleData, active: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-200 text-sky-600 focus:ring-sky-200"
                    />
                    <label htmlFor="vehicle-active" className="text-xs text-slate-600">فعال</label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">یادداشت</label>
                    <textarea
                      value={vehicleData.notes || ''}
                      onChange={(e) => setVehicleData({ ...vehicleData, notes: e.target.value })}
                      className={`${inputCls} h-20`}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => setShowVehicleModal(false)} className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
                      لغو
                    </button>
                    <button onClick={handleVehicleSubmit} className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl">
                      ذخیره
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </ModalPortal>
        )}
      </div>
    );
  };

  const renderAvailability = () => {

    const handleAddAvailability = async () => {
      if (!selectedInstructor) return;

      try {
        await api.createAvailability({
          ...newAvailability,
          instructor_id: selectedInstructor,
        });
        refresh();
      } catch (e) {
        setErr((e as Error).message || 'خطا در افزودن ساعت حضور');
      }
    };

    const handleDeleteAvailability = async (id: number) => {
      if (!window.confirm('آیا مطمئن هستید که می‌خواهید این ساعت حضور را حذف کنید؟')) return;

      try {
        await api.deleteAvailability(id);
        refresh();
      } catch (e) {
        setErr((e as Error).message || 'خطا در حذف ساعت حضور');
      }
    };

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800">ساعات حضور مربیان</h2>
              <p className="text-xs text-slate-500">مدیریت ساعات حضور مربیان در روزهای هفته</p>
            </div>
          </div>
          <button onClick={refresh} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[200px]">
            <select
              value={selectedInstructor || ''}
              onChange={(e) => setSelectedInstructor(e.target.value ? Number(e.target.value) : undefined)}
              className={inputCls}
            >
              <option value="">همه مربیان</option>
              {instructors.filter(i => i.active).map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">افزودن ساعت حضور</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">روز هفته</label>
              <select
                value={newAvailability.weekday}
                onChange={(e) => setNewAvailability({ ...newAvailability, weekday: Number(e.target.value) })}
                className={inputCls}
              >
                {api.WEEKDAY_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">ساعت شروع</label>
              <input
                type="time"
                value={newAvailability.start_time}
                onChange={(e) => setNewAvailability({ ...newAvailability, start_time: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">ساعت پایان</label>
              <input
                type="time"
                value={newAvailability.end_time}
                onChange={(e) => setNewAvailability({ ...newAvailability, end_time: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleAddAvailability}
                disabled={!selectedInstructor}
                className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                افزودن
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">اگر برای مربی ساعتی ثبت نشود، محدودیتی اعمال نمی‌شود.</p>
        </div>

        {loading ? (
          <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-1.5">
            <Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...
          </div>
        ) : filteredAvailability.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-8 text-center">ساعتی برای نمایش وجود ندارد.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {['مربی', 'روز هفته', 'ساعت شروع', 'ساعت پایان', ''].map(h => (
                    <th key={h} className="px-3 py-2.5 font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAvailability.map(a => (
                  <tr key={a.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                    <td className="px-3 py-2.5 font-bold text-slate-800">
                      {instructors.find(i => i.id === a.instructor_id)?.name || `مربی #${a.instructor_id}`}
                    </td>
                    <td className="px-3 py-2.5">{api.WEEKDAY_LABELS[a.weekday]}</td>
                    <td className="px-3 py-2.5">{a.start_time}</td>
                    <td className="px-3 py-2.5">{a.end_time}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => handleDeleteAvailability(a.id)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" aria-label="حذف">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderReminders = () => {

    const loadReminderConfig = async () => {
      try {
        const config = await api.getReminderConfig();
        setReminderConfig(config);
      } catch (e) {
        setErr((e as Error).message || 'خطا در بارگذاری تنظیمات یادآور');
      }
    };


    const handlePreview = async () => {
      try {
        const result = await api.runReminders(true);
        setPreviewCandidates(result.candidates);
      } catch (e) {
        setErr((e as Error).message || 'خطا در پیش‌نمایش ارسال');
      }
    };

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800">یادآور پیامکی</h2>
              <p className="text-xs text-slate-500">مدیریت تنظیمات و ارسال یادآورهای پیامکی</p>
            </div>
          </div>
          <button onClick={refresh} className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50" aria-label="به‌روزرسانی">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

        {loading ? (
          <div className="text-xs text-slate-400 py-8 text-center flex items-center justify-center gap-1.5">
            <Loader2 className="w-4 h-4 animate-spin" />در حال بارگذاری...
          </div>
        ) : !isAdmin ? (
          <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-8 text-center">شما دسترسی به این بخش ندارید.</div>
        ) : !reminderConfig ? (
          <div className="bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 py-8 text-center">تنظیماتی برای نمایش وجود ندارد.</div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-bold text-slate-800">تنظیمات یادآور</h3>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${reminderConfig.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                  {reminderConfig.enabled ? 'فعال' : 'غیرفعال'}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-600">ساعت قبل از جلسه: {reminderConfig.hours_before}</p>
                  <p className="text-xs text-slate-600">قالب پیامک: {reminderConfig.template_key}</p>
                  <p className="text-xs text-slate-600">شماره آزمایشی: {reminderConfig.test_mobile_masked}</p>
                  <p className="text-xs text-slate-600">پیکربندی پیامک: {reminderConfig.sms_configured ? 'فعال' : 'غیرفعال'}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handlePreview}
                    className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                  >
                    پیش‌نمایش ارسال
                  </button>
                  {reminderConfig.enabled && (
                    <button
                      onClick={handleReminderSend}
                      className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl"
                    >
                      ارسال واقعی
                    </button>
                  )}
                </div>
              </div>
            </div>

            {previewCandidates.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-slate-800 mb-3">جلسات انتخاب شده برای ارسال</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        {['شناسه جلسه', 'هنرجو', 'موبایل', 'تاریخ', 'ساعت'].map(h => (
                          <th key={h} className="px-3 py-2.5 font-bold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewCandidates.map(c => (
                        <tr key={c.booking_id} className="border-t border-slate-100 hover:bg-sky-50/40">
                          <td className="px-3 py-2.5">{c.booking_id}</td>
                          <td className="px-3 py-2.5">{c.student_name}</td>
                          <td className="px-3 py-2.5" dir="ltr">{c.phone_masked}</td>
                          <td className="px-3 py-2.5">{c.lesson_date}</td>
                          <td className="px-3 py-2.5">{c.start_time}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 fade-in" dir="rtl">
      <div className="flex flex-wrap gap-2">
        {TABS.filter(t => t.id !== 'reminders' || isAdmin).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${
              tab === id ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {notice && <p role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex justify-between gap-2"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="بستن"><X className="w-3.5 h-3.5" /></button></p>}
      {tab === 'calendar' && err && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}
      {tab === 'calendar' && renderCalendar()}
      {tab === 'vehicles' && renderVehicles()}
      {tab === 'availability' && renderAvailability()}
      {tab === 'reminders' && renderReminders()}

      {showModal && (
        <ModalPortal>
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-800">{modalMode === 'create' ? 'رزرو جدید' : 'ویرایش رزرو'}</h3>
                <button onClick={() => setShowModal(false)} className="p-1 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="بستن">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {modalErrors.general && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{modalErrors.general}</p>}

                {modalConflicts.length > 0 && (
                  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                    <p className="font-bold">تداخل با رزروهای موجود:</p>
                    <ul className="list-disc list-inside mt-1">
                      {modalConflicts.map(c => (
                        <li key={c.booking_id}>
                          رزرو #{c.booking_id}: {c.kind === 'instructor' ? 'مربی' : c.kind === 'vehicle' ? 'خودرو' : 'هنرجو'}، ساعت {c.start_time} تا {c.end_time}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {modalWarnings.length > 0 && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    <p className="font-bold">هشدارها:</p>
                    <ul className="list-disc list-inside mt-1">
                      {modalWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">هنرجو</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={studentSearch || (modalData.student_id ? (() => { const st = students.find(s => s.id === modalData.student_id); return st ? `${st.first_name} ${st.last_name}` : `#${modalData.student_id}`; })() : '')}
                      onChange={(e) => { setStudentSearch(e.target.value); if (modalData.student_id) setModalData({ ...modalData, student_id: undefined }); }}
                      className={`${inputCls} ${modalErrors.student_id ? 'border-rose-200 focus:ring-rose-200' : ''}`}
                      placeholder="جستجو نام یا شماره موبایل..."
                    />
                    {studentSearch && filteredStudents.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                        {filteredStudents.map(s => (
                          <div
                            key={s.id}
                            onClick={() => {
                              setModalData({ ...modalData, student_id: s.id });
                              setStudentSearch('');
                            }}
                            className="px-3 py-2 hover:bg-sky-50 cursor-pointer text-xs"
                          >
                            {s.first_name} {s.last_name} {s.phone_number ? <span dir="ltr" className="text-slate-400 font-mono">{maskPhone(s.phone_number)}</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {modalErrors.student_id && <p className="text-[11px] text-rose-600 mt-1">{modalErrors.student_id}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">مربی</label>
                  <select
                    value={modalData.instructor_id || ''}
                    onChange={(e) => setModalData({ ...modalData, instructor_id: Number(e.target.value) })}
                    className={`${inputCls} ${modalErrors.instructor_id ? 'border-rose-200 focus:ring-rose-200' : ''}`}
                  >
                    <option value="">— انتخاب کنید —</option>
                    {instructors.filter(i => i.active).map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  {modalErrors.instructor_id && <p className="text-[11px] text-rose-600 mt-1">{modalErrors.instructor_id}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">خودرو (اختیاری)</label>
                  <select
                    value={modalData.vehicle_id || ''}
                    onChange={(e) => setModalData({ ...modalData, vehicle_id: e.target.value ? Number(e.target.value) : null })}
                    className={inputCls}
                  >
                    <option value="">— انتخاب کنید —</option>
                    {vehicles.filter(v => v.active).map(v => (
                      <option key={v.id} value={v.id}>{v.name} {v.plate ? `(${v.plate})` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">تاریخ</label>
                    <input
                      type="text"
                      value={modalData.lesson_date || ''}
                      onChange={(e) => setModalData({ ...modalData, lesson_date: e.target.value })}
                      className={`${inputCls} ${modalErrors.lesson_date ? 'border-rose-200 focus:ring-rose-200' : ''}`}
                      placeholder="1405/08/07"
                      dir="ltr"
                    />
                    {modalErrors.lesson_date && <p className="text-[11px] text-rose-600 mt-1">{modalErrors.lesson_date}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">ساعت شروع</label>
                    <input
                      type="time"
                      value={modalData.start_time || ''}
                      onChange={(e) => setModalData({ ...modalData, start_time: e.target.value })}
                      className={`${inputCls} ${modalErrors.start_time ? 'border-rose-200 focus:ring-rose-200' : ''}`}
                    />
                    {modalErrors.start_time && <p className="text-[11px] text-rose-600 mt-1">{modalErrors.start_time}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">ساعت پایان</label>
                  <input
                    type="time"
                    value={modalData.end_time || ''}
                    onChange={(e) => setModalData({ ...modalData, end_time: e.target.value })}
                    className={`${inputCls} ${modalErrors.end_time ? 'border-rose-200 focus:ring-rose-200' : ''}`}
                  />
                  {modalErrors.end_time && <p className="text-[11px] text-rose-600 mt-1">{modalErrors.end_time}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">یادداشت</label>
                  <textarea
                    value={modalData.notes || ''}
                    onChange={(e) => setModalData({ ...modalData, notes: e.target.value })}
                    className={inputCls}
                    rows={3}
                  />
                </div>

                {needsForce && (
                  <label className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    <input type="checkbox" checked={forceOutsideAvailability} onChange={(e) => setForceOutsideAvailability(e.target.checked)} className="w-4 h-4" />
                    با وجود خارج بودن از ساعات حضور مربی ثبت شود
                  </label>
                )}

                {modalMode === 'edit' && modalData.status === 'scheduled' && (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={logSession} onChange={(e) => setLogSession(e.target.checked)} className="w-4 h-4" />
                    هنگام «برگزار شد»، در جلسات حق‌التدریس مربی ثبت شود
                  </label>
                )}

                {modalMode === 'edit' && modalData.status && modalData.status !== 'scheduled' && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleStatusChange('scheduled')}
                      className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                    >
                      بازگشت به رزرو
                    </button>
                  </div>
                )}

                {modalMode === 'edit' && modalData.status === 'scheduled' && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleStatusChange('done', logSession)}
                      className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl"
                    >
                      برگزار شد
                    </button>
                    <button
                      onClick={() => handleStatusChange('no_show')}
                      className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl"
                    >
                      غیبت
                    </button>
                    <button
                      onClick={handleCancel}
                      className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl"
                    >
                      لغو جلسه
                    </button>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowModal(false)} className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
                    لغو
                  </button>
                  <button onClick={handleModalSubmit} className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl">
                    ذخیره
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
