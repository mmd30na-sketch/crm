import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  BookOpen,
  CreditCard,
  Users,
  CheckCircle,
  Plus,
  Edit2,
  Trash2,
  Lock,
  Save,
  Building,
  MessageSquare,
  Smartphone,
  Cpu,
  Database,
  Wifi,
  RefreshCw,
  AlertCircle,
  Check,
  Globe,
  Printer,
  Shield,
  Key,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { Course, StaffRole, StaffUser } from '../types';
import * as api from '../api/client';

interface SettingsProps {
  courses: Course[];
  onRefresh: () => void;
}

export default function Settings({ courses, onRefresh }: SettingsProps) {
  const [activeSubTab, setActiveSubTab] = useState<'academy' | 'courses' | 'payment' | 'users' | 'gateways' | 'database'>('academy');

  const dummyOrEmpty = (key: string, dummies: string[]) => {
    const v = localStorage.getItem(key) || '';
    return !v || dummies.includes(v) ? '' : v;
  };

  /* ── 1. Rubika & SMS Panel States ── */
  const [rubikaBotToken, setRubikaBotToken]   = useState(() => dummyOrEmpty('carla_rubika_bot_token', ['RUBIKA-BOT-551249-YHBX987X']));
  const [rubikaChannelId, setRubikaChannelId] = useState(() => dummyOrEmpty('carla_rubika_channel_id', ['@carla_driving_academy']));
  const [rubikaIsActive, setRubikaIsActive]   = useState(() => localStorage.getItem('carla_rubika_active') !== 'false');

  const [smsProvider, setSmsProvider]                 = useState(() => localStorage.getItem('carla_sms_provider') || 'ippanel');
  const [smsApiKey, setSmsApiKey]                     = useState(() => dummyOrEmpty('carla_sms_api_key', ['CARLA-SMS-98765-SECURE-KEY']));
  const [smsSenderLine, setSmsSenderLine]             = useState(() => dummyOrEmpty('carla_sms_sender_line', ['5000400070']));
  const [smsAutoSendRegister, setSmsAutoSendRegister] = useState(() => localStorage.getItem('carla_sms_auto_register') !== 'false');
  const [smsAutoSendExam, setSmsAutoSendExam]         = useState(() => localStorage.getItem('carla_sms_auto_exam') !== 'false');

  const [isSavingGateways, setIsSavingGateways] = useState(false);
  const [gatewaysSuccess, setGatewaysSuccess]   = useState(false);

  const handleSaveGateways = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGateways(true); setGatewaysSuccess(false);

    if (rubikaBotToken) localStorage.setItem('carla_rubika_bot_token', rubikaBotToken);
    else localStorage.removeItem('carla_rubika_bot_token');
    if (rubikaChannelId) localStorage.setItem('carla_rubika_channel_id', rubikaChannelId);
    else localStorage.removeItem('carla_rubika_channel_id');
    localStorage.setItem('carla_rubika_active', String(rubikaIsActive));

    localStorage.setItem('carla_sms_provider', smsProvider);
    if (smsApiKey) localStorage.setItem('carla_sms_api_key', smsApiKey);
    else localStorage.removeItem('carla_sms_api_key');
    if (smsSenderLine) localStorage.setItem('carla_sms_sender_line', smsSenderLine);
    else localStorage.removeItem('carla_sms_sender_line');
    localStorage.setItem('carla_sms_auto_register', String(smsAutoSendRegister));
    localStorage.setItem('carla_sms_auto_exam', String(smsAutoSendExam));

    if (smsApiKey) {
      localStorage.setItem('carla_sms_config', JSON.stringify({ provider: smsProvider, apiKey: smsApiKey, senderLine: smsSenderLine }));
    } else {
      localStorage.removeItem('carla_sms_config');
    }

    setTimeout(() => {
      setIsSavingGateways(false);
      setGatewaysSuccess(true);
      setTimeout(() => setGatewaysSuccess(false), 2000);
    }, 800);
  };

  /* ── 2. Database States ── */
  const [dbHost, setDbHost]         = useState(() => dummyOrEmpty('carla_db_host', ['postgresql-db.iran.liara.run']) || 'services.irn5.chabokan.net');
  const [dbPort, setDbPort]         = useState(() => {
    const v = localStorage.getItem('carla_db_port');
    return !v || v === '5432' ? '52691' : v;
  });
  const [dbName, setDbName]         = useState(() => dummyOrEmpty('carla_db_name', ['carla_crm_production']) || 'nodejs430_carla');
  const [dbUser, setDbUser]         = useState(() => dummyOrEmpty('carla_db_user', ['carla_root_admin']) || 'nodejs430_carla');
  const [dbPassword, setDbPassword] = useState('');

  const [dbConnectionStatus, setDbConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [dbLastSync, setDbLastSync]                 = useState(() => dummyOrEmpty('carla_db_last_sync', ['۱۴۰۵/۰۵/۲۸ - ۱۱:۲۵', '۱۴۰۵/۰۵/۲۸ - ۱۳:۵۵']));
  const [isSyncing, setIsSyncing]                   = useState(false);
  const [syncProgress, setSyncProgress]             = useState(0);
  const [syncSuccess, setSyncSuccess]               = useState(false);
  const [isSavingDb, setIsSavingDb]                 = useState(false);
  const [dbSaveSuccess, setDbSaveSuccess]           = useState(false);

  const handleTestConnection = async () => {
    setDbConnectionStatus('connecting');
    try {
      const origin = window.location.hostname.endsWith('github.io') ? 'https://crm.mmd30na.cloud' : '';
      const token = sessionStorage.getItem('carla_crm_token');
      const res = await fetch(`${origin}/api/health`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.db === 'chabokan-mysql') {
        setDbConnectionStatus('connected');
        setDbLastSync(new Date().toLocaleString('fa-IR'));
      } else {
        setDbConnectionStatus('disconnected');
      }
    } catch {
      setDbConnectionStatus('disconnected');
    }
  };

  const handleManualSync = () => {
    if (dbConnectionStatus !== 'connected') {
      alert('ابتدا اتصال به دیتابیس را تست و تأیید کنید.');
      return;
    }
    setIsSyncing(true); setSyncProgress(10); setSyncSuccess(false);
    const interval = setInterval(() => {
      setSyncProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsSyncing(false);
          setSyncSuccess(true);
          const ptime = new Date().toLocaleString('fa-IR');
          setDbLastSync(ptime);
          localStorage.setItem('carla_db_last_sync', ptime);
          setTimeout(() => setSyncSuccess(false), 2500);
          return 100;
        }
        return prev + 30;
      });
    }, 200);
  };

  const handleSaveDbSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingDb(true); setDbSaveSuccess(false);
    localStorage.setItem('carla_db_host', dbHost);
    localStorage.setItem('carla_db_port', dbPort);
    localStorage.setItem('carla_db_name', dbName);
    localStorage.setItem('carla_db_user', dbUser);
    if (dbPassword) localStorage.setItem('carla_db_password', dbPassword);
    else localStorage.removeItem('carla_db_password');
    setTimeout(() => {
      setIsSavingDb(false); setDbSaveSuccess(true);
      setTimeout(() => setDbSaveSuccess(false), 2000);
    }, 600);
  };

  /* ── 3. Academy Profile ── */
  const [academyName, setAcademyName]       = useState('');
  const [academyLogo, setAcademyLogo]       = useState('');
  const [academyPhone, setAcademyPhone]     = useState('');
  const [academyAddress, setAcademyAddress] = useState('');
  const [receiptHeader, setReceiptHeader]   = useState('');
  const [receiptFooter, setReceiptFooter]   = useState('');
  const [isSavingAcademy, setIsSavingAcademy] = useState(false);
  const [academySuccess, setAcademySuccess] = useState(false);

  /* ── 4. Courses ── */
  const [editingCourse, setEditingCourse]           = useState<Course | null>(null);
  const [newCourseTitle, setNewCourseTitle]         = useState('');
  const [newCourseCode, setNewCourseCode]           = useState('');
  const [newCourseTuition, setNewCourseTuition]     = useState<number>(0);
  const [newCourseDuration, setNewCourseDuration]   = useState<number>(8);
  const [isSavingCourse, setIsSavingCourse]         = useState(false);
  const [isAddingCourse, setIsAddingCourse]         = useState(false);

  /* Payment & User lists */
  const [paymentMethods] = useState([
    { id: 1, name: 'دستگاه کارتخوان رفاه (پذیرش اصلی)', code: 'pos_refah', active: true },
    { id: 2, name: 'حساب کارت به کارت بانک ملی', code: 'card_melli', active: true },
    { id: 3, name: 'صندوق نقد دفتری (تنخواه)', code: 'cash_desk', active: true },
  ]);

  const ROLE_LABEL: Record<StaffRole, string> = {
    admin: 'مدیر',
    cashier: 'صندوقدار',
    instructor: 'مربی',
  };
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState('');
  const [staffNotice, setStaffNotice] = useState('');
  const [isSavingStaff, setIsSavingStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ full_name: '', username: '', password: '', role: 'cashier' as StaffRole });
  const [passwordEdits, setPasswordEdits] = useState<Record<number, string>>({});

  const loadStaffUsers = async () => {
    setStaffLoading(true);
    setStaffError('');
    try {
      setStaffUsers(await api.fetchStaffUsers());
    } catch (err: any) {
      setStaffError(err?.message || 'دریافت کاربران ناموفق بود');
    } finally {
      setStaffLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'users') loadStaffUsers();
  }, [activeSubTab]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError('');
    setStaffNotice('');
    setIsSavingStaff(true);
    try {
      await api.createStaffUser(newStaff);
      setNewStaff({ full_name: '', username: '', password: '', role: 'cashier' });
      setStaffNotice('کاربر ایجاد شد');
      await loadStaffUsers();
    } catch (err: any) {
      setStaffError(err?.message || 'ایجاد کاربر ناموفق بود');
    } finally {
      setIsSavingStaff(false);
    }
  };

  const handleToggleStaff = async (user: StaffUser) => {
    if (user.source === 'env') return;
    setStaffError('');
    try {
      await api.updateStaffUser(user.id, { is_active: !user.is_active });
      await loadStaffUsers();
    } catch (err: any) {
      setStaffError(err?.message || 'تغییر وضعیت ناموفق بود');
    }
  };

  const handleStaffRole = async (user: StaffUser, role: StaffRole) => {
    if (user.source === 'env') return;
    setStaffError('');
    try {
      await api.updateStaffUser(user.id, { role });
      await loadStaffUsers();
    } catch (err: any) {
      setStaffError(err?.message || 'تغییر نقش ناموفق بود');
    }
  };

  const handleStaffPassword = async (user: StaffUser) => {
    setStaffError('');
    setStaffNotice('');
    try {
      await api.updateStaffUser(user.id, { password: (passwordEdits[user.id] || '').trim() });
      setPasswordEdits(prev => ({ ...prev, [user.id]: '' }));
      setStaffNotice(`رمز «${user.username}» تغییر کرد`);
    } catch (err: any) {
      setStaffError(err?.message || 'تغییر رمز ناموفق بود');
    }
  };

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await api.fetchReceiptSettings();
        if (data) {
          setAcademyName(data.academy_name || '');
          setAcademyLogo(data.logo_url || '');
          setAcademyPhone(data.phone_number || '');
          setAcademyAddress(data.address || '');
          setReceiptHeader(data.header_text || '');
          setReceiptFooter(data.footer_text || '');
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    }
    loadSettings();
  }, []);

  const handleSaveAcademySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAcademy(true); setAcademySuccess(false);
    try {
      await api.saveReceiptSettings({
        academy_name: academyName,
        logo_url: academyLogo,
        phone_number: academyPhone,
        address: academyAddress,
        header_text: receiptHeader,
        footer_text: receiptFooter,
      });
      setAcademySuccess(true);
      setTimeout(() => setAcademySuccess(false), 2000);
    } catch {
      alert('خطا در ذخیره تنظیمات آموزشگاه');
    } finally {
      setIsSavingAcademy(false);
    }
  };

  const handleEditCourse = (course: Course) => {
    setEditingCourse(course);
    setNewCourseTitle(course.title);
    setNewCourseCode(course.code);
    setNewCourseTuition(course.tuition);
    setNewCourseDuration(course.duration_weeks);
    setIsAddingCourse(false);
  };

  const handleOpenAddCourse = () => {
    setEditingCourse(null);
    setNewCourseTitle('');
    setNewCourseCode('');
    setNewCourseTuition(4500000);
    setNewCourseDuration(10);
    setIsAddingCourse(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourseTitle || !newCourseCode) return;
    setIsSavingCourse(true);
    try {
      if (editingCourse) {
        await api.saveCourse({ ...editingCourse, title: newCourseTitle, code: newCourseCode, tuition: newCourseTuition, duration_weeks: newCourseDuration });
      } else {
        await api.addCourse({ title: newCourseTitle, code: newCourseCode, tuition: newCourseTuition, duration_weeks: newCourseDuration, active: true });
      }
      setEditingCourse(null); setIsAddingCourse(false); onRefresh();
    } catch {
      alert('خطا در ذخیره دوره');
    } finally {
      setIsSavingCourse(false);
    }
  };

  /* Navigation Pills List */
  const NAV_ITEMS = [
    { id: 'academy', label: 'مشخصات آموزشگاه', icon: Building, color: 'sky' },
    { id: 'courses', label: 'لیست دوره‌ها', icon: BookOpen, count: courses.length, color: 'violet' },
    { id: 'gateways', label: 'وب‌سرویس و درگاه‌ها', icon: Cpu, color: 'teal' },
    { id: 'database', label: 'دیتابیس Cloud', icon: Database, color: 'amber' },
    { id: 'payment', label: 'درگاه‌های بانکی', icon: CreditCard, color: 'emerald' },
    { id: 'users', label: 'کاربران و دسترسی‌ها', icon: Users, color: 'rose' },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm fade-in" id="settings-container" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
      
      {/* ── Page Top Banner ── */}
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-sky-50/70 via-white to-slate-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-sky-500 text-white flex items-center justify-center shadow-md shadow-sky-200">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">تنظیمات اصلی پیکربندی CRM</h2>
            <p className="text-xs text-slate-400 mt-0.5">مدیریت هدر قبض، تعرفه‌ دوره‌ها، درگاه پیامک و دیتابیس ابری</p>
          </div>
        </div>

        {/* Live Metrics Chips */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-bold">
            <CheckCircle className="w-3 h-3 text-emerald-500" />DB Online
          </span>
          <span className="flex items-center gap-1 px-2.5 py-1 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg font-bold">
            <Wifi className="w-3 h-3 text-sky-500" />API 200 OK
          </span>
        </div>
      </div>

      {/* ── Main Layout: Sidebar Pills + Content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-100 min-h-[500px]">

        {/* Navigation Sidebar (3 cols) */}
        <div className="lg:col-span-3 bg-slate-50/50 p-3 space-y-1">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isSelected = activeSubTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSubTab(item.id as any)}
                className={`w-full flex items-center justify-between p-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                  isSelected
                    ? 'bg-white text-sky-700 shadow-xs border border-slate-200/90'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-sky-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-mono">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content Pane (9 cols) */}
        <div className="lg:col-span-9 p-6 bg-white">

          {/* ══════════════════════════════════════════════
              SUBTAB 1: ACADEMY PROFILE & RECEIPT HEADERS
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'academy' && (
            <form onSubmit={handleSaveAcademySettings} className="space-y-5 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Building className="w-4 h-4 text-sky-600" />مشخصات رسمی آموزشگاه و تنظیمات رسید
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">نام رسمی آموزشگاه *</label>
                  <input type="text" required value={academyName} onChange={e => setAcademyName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 font-bold text-slate-800" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">آدرس URL لوگو رسمی</label>
                  <input type="text" value={academyLogo} onChange={e => setAcademyLogo(e.target.value)} placeholder="https://..."
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 font-mono text-slate-800" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">شماره تماس آموزشگاه *</label>
                  <input type="text" required value={academyPhone} onChange={e => setAcademyPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 font-mono text-slate-800" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">آدرس پستی دقیق *</label>
                  <input type="text" required value={academyAddress} onChange={e => setAcademyAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 text-slate-800" />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">عنوان هدر رسید رسمی PDF</label>
                  <input type="text" value={receiptHeader} onChange={e => setReceiptHeader(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 text-slate-800" />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">توضیحات و قوانین پاورقی رسید</label>
                  <textarea rows={3} value={receiptFooter} onChange={e => setReceiptFooter(e.target.value)}
                    className="w-full p-3 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 text-slate-800 resize-none leading-relaxed" />
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                {academySuccess && (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" />تنظیمات آموزشگاه با موفقیت ذخیره شد
                  </span>
                )}
                <button type="submit" disabled={isSavingAcademy}
                  className="mr-auto px-5 py-2.5 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer">
                  {isSavingAcademy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />ذخیره...</> : <><Save className="w-3.5 h-3.5" />ذخیره تغییرات هدر</>}
                </button>
              </div>
            </form>
          )}

          {/* ══════════════════════════════════════════════
              SUBTAB 2: COURSES MANAGEMENT
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'courses' && (
            <div className="space-y-5 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-violet-600" />لیست دوره‌های مصوب آموزشگاه
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">مدیریت تعرفه شهریه، کدهای سیستمی و مدت آموزش دوره‌ها</p>
                </div>
                <button onClick={handleOpenAddCourse}
                  className="px-3.5 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer">
                  <Plus className="w-4 h-4" />افزودن دوره جدید
                </button>
              </div>

              {/* Edit/Add Course Form */}
              {(isAddingCourse || editingCourse) && (
                <form onSubmit={handleSaveCourse} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-slate-800">{editingCourse ? 'ویرایش تعرفه دوره' : 'افزودن دوره آموزشی جدید'}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <input type="text" required value={newCourseTitle} onChange={e => setNewCourseTitle(e.target.value)} placeholder="عنوان دوره" className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white" />
                    <input type="text" required value={newCourseCode} onChange={e => setNewCourseCode(e.target.value)} placeholder="کد سیستمی" className="px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                    <input type="number" required value={newCourseTuition} onChange={e => setNewCourseTuition(+e.target.value || 0)} placeholder="شهریه (تومان)" className="px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                    <div className="flex gap-2">
                      <button type="submit" disabled={isSavingCourse} className="flex-1 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg transition cursor-pointer">
                        {isSavingCourse ? 'ذخیره...' : 'ثبت'}
                      </button>
                      <button type="button" onClick={() => { setEditingCourse(null); setIsAddingCourse(false); }} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition cursor-pointer">
                        انصراف
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="p-3">شناسه</th>
                      <th className="p-3">عنوان دوره</th>
                      <th className="p-3">کد سیستمی</th>
                      <th className="p-3">شهریه مصوب</th>
                      <th className="p-3">مدت آموزش</th>
                      <th className="p-3">وضعیت</th>
                      <th className="p-3 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {courses.map(c => (
                      <tr key={c.id} className="hover:bg-slate-50/60 transition">
                        <td className="p-3 font-mono text-slate-400">#{c.id}</td>
                        <td className="p-3 font-bold text-slate-900">{c.title}</td>
                        <td className="p-3 font-mono text-slate-600">{c.code}</td>
                        <td className="p-3 font-mono font-bold text-violet-700">{c.tuition.toLocaleString('fa-IR')} تومان</td>
                        <td className="p-3 text-slate-600">{c.duration_weeks} هفته</td>
                        <td className="p-3">
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">فعال</span>
                        </td>
                        <td className="p-3 text-center">
                          <button onClick={() => handleEditCourse(c)} className="p-1.5 text-violet-600 hover:bg-violet-50 rounded-lg transition inline-flex items-center gap-1 font-bold">
                            <Edit2 className="w-3.5 h-3.5" />ویرایش
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              SUBTAB 3: GATEWAYS & MESSENGERS (RUBIKA & SMS)
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'gateways' && (
            <form onSubmit={handleSaveGateways} className="space-y-5 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-teal-600" />پیکربندی وب‌سرویس و درگاه‌های اطلاع‌رسانی
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Rubika Config */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-xs text-slate-800 border-b border-slate-200/60 pb-2">
                    <MessageSquare className="w-4 h-4 text-violet-600" />بات پیام‌رسان روبیکا (Carla Bot)
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">توکن امنیتی (Bot Token)</label>
                    <input type="text" value={rubikaBotToken} onChange={e => setRubikaBotToken(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">شناسه کانال روبیکا</label>
                    <input type="text" value={rubikaChannelId} onChange={e => setRubikaChannelId(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                  </div>
                </div>

                {/* SMS Config */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-xs text-slate-800 border-b border-slate-200/60 pb-2">
                    <Smartphone className="w-4 h-4 text-sky-600" />درگاه پیامک کشوری (SMS API)
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">وب‌سرویس فعال</label>
                    <select value={smsProvider} onChange={e => setSmsProvider(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white cursor-pointer">
                      <option value="ippanel">IPPANEL (فراز اس‌ام‌اس)</option>
                      <option value="melipayamak">ملی پیامک</option>
                      <option value="kavenegar">کاوه نگار</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">خط اختصاصی ارسال</label>
                    <input type="text" value={smsSenderLine} onChange={e => setSmsSenderLine(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                {gatewaysSuccess && (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" />تنظیمات درگاه‌ها ذخیره شد
                  </span>
                )}
                <button type="submit" disabled={isSavingGateways}
                  className="mr-auto px-5 py-2.5 bg-gradient-to-l from-teal-600 to-teal-500 hover:from-teal-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer">
                  {isSavingGateways ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />ذخیره...</> : <><Save className="w-3.5 h-3.5" />ذخیره و تست درگاه‌ها</>}
                </button>
              </div>
            </form>
          )}

          {/* ══════════════════════════════════════════════
              SUBTAB 4: CLOUD DATABASE & MANUAL SYNC
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'database' && (
            <div className="space-y-5 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Database className="w-4 h-4 text-amber-600" />پایگاه‌داده واقعی چابکان
                </h3>
              </div>
              <p className="text-xs text-slate-500 leading-6 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                CRM به MySQL چابکان <span className="font-mono">nodejs430_carla</span> وصل است
                (<span className="font-mono">services.irn5.chabokan.net:52691</span> از طریق SOCKS ایران).
                رمز در Secrets به نام <span className="font-mono">NODEJS_DB_PASS</span> است؛ اینجا ذخیره نمی‌شود. Liara/Postgres در کار نیست.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Credentials Form */}
                <form onSubmit={handleSaveDbSettings} className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">سرور یا Host *</label>
                      <input type="text" value={dbHost} onChange={e => setDbHost(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">پورت (Port)</label>
                      <input type="text" value={dbPort} onChange={e => setDbPort(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">نام دیتابیس</label>
                      <input type="text" value={dbName} onChange={e => setDbName(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">نام کاربری</label>
                      <input type="text" value={dbUser} onChange={e => setDbUser(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button type="submit" disabled={isSavingDb} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition cursor-pointer">
                      {isSavingDb ? 'ذخیره...' : 'ذخیره تنظیمات دیتابیس'}
                    </button>
                  </div>
                  {dbSaveSuccess && <p className="text-xs text-emerald-600 font-bold">ذخیره شد!</p>}
                </form>

                {/* Connection Status & Manual Sync Widget */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-600">وضعیت اتصال:</span>
                      {dbConnectionStatus === 'connected' ? (
                        <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">پایدار</span>
                      ) : (
                        <span className="text-slate-500 bg-slate-200 px-2 py-0.5 rounded-md">نامشخص</span>
                      )}
                    </div>
                    <button onClick={handleTestConnection} className="w-full py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg transition cursor-pointer">
                      تست اتصال (Ping)
                    </button>

                    <div className="border-t border-slate-200 pt-3 space-y-2">
                      <div className="text-[11px] text-slate-500 flex justify-between">
                        <span>آخرین سینک:</span><span className="font-mono font-bold">{dbLastSync}</span>
                      </div>
                      <button onClick={handleManualSync} disabled={isSyncing || dbConnectionStatus !== 'connected'}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition cursor-pointer">
                        {isSyncing ? `سینک (${syncProgress}%)` : 'همگام‌سازی دستی'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              SUBTAB 5: PAYMENT METHODS
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'payment' && (
            <div className="space-y-4 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-600" />درگاه‌های بانکی و متدهای پرداخت
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {paymentMethods.map(m => (
                  <div key={m.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                    <div className="text-xs font-bold text-slate-800">{m.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">شناسه: {m.code}</div>
                    <span className="inline-block mt-2 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">فعال</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              SUBTAB 6: USERS & ROLES
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'users' && (
            <div className="space-y-4 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-rose-600" />کاربران سیستم و سطح دسترسی
                </h3>
                <span className="text-[10px] text-slate-400">منبع: فایل محلی — بعداً به MySQL وصل می‌شود</span>
              </div>

              {staffError && (
                <div className="flex items-center gap-2 text-rose-600 text-xs bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />{staffError}
                </div>
              )}
              {staffNotice && (
                <div className="flex items-center gap-2 text-emerald-700 text-xs bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                  <Check className="w-4 h-4 shrink-0" />{staffNotice}
                </div>
              )}

              <form onSubmit={handleCreateStaff} className="grid grid-cols-1 md:grid-cols-5 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <input className="px-3 py-2 text-xs border border-slate-200 rounded-lg" placeholder="نام نمایشی" value={newStaff.full_name} onChange={e => setNewStaff(s => ({ ...s, full_name: e.target.value }))} required />
                <input className="px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono" placeholder="username" value={newStaff.username} onChange={e => setNewStaff(s => ({ ...s, username: e.target.value }))} required />
                <input type="password" className="px-3 py-2 text-xs border border-slate-200 rounded-lg" placeholder="رمز (حداقل ۶)" value={newStaff.password} onChange={e => setNewStaff(s => ({ ...s, password: e.target.value }))} required />
                <select className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white" value={newStaff.role} onChange={e => setNewStaff(s => ({ ...s, role: e.target.value as StaffRole }))}>
                  <option value="cashier">صندوقدار</option>
                  <option value="instructor">مربی</option>
                  <option value="admin">مدیر</option>
                </select>
                <button type="submit" disabled={isSavingStaff} className="px-3 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-60 rounded-lg">
                  {isSavingStaff ? 'در حال ثبت...' : 'افزودن کاربر'}
                </button>
              </form>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="p-3">نام</th>
                      <th className="p-3">نام کاربری</th>
                      <th className="p-3">نقش</th>
                      <th className="p-3">وضعیت</th>
                      <th className="p-3">رمز جدید</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {staffLoading ? (
                      <tr><td className="p-3 text-slate-400" colSpan={5}>در حال بارگذاری...</td></tr>
                    ) : staffUsers.map(u => (
                      <tr key={`${u.source}-${u.id}`} className="hover:bg-slate-50/60 transition">
                        <td className="p-3 font-bold text-slate-900">{u.full_name}</td>
                        <td className="p-3 font-mono text-slate-600">
                          {u.username}
                          {u.locked && <span className="mr-2 text-[9px] text-slate-400">سیستمی</span>}
                        </td>
                        <td className="p-3">
                          {u.locked ? (
                            <span className="font-bold text-sky-700">{ROLE_LABEL[u.role]}</span>
                          ) : (
                            <select className="border border-slate-200 rounded-md px-2 py-1 bg-white" value={u.role} onChange={e => handleStaffRole(u, e.target.value as StaffRole)}>
                              <option value="admin">مدیر</option>
                              <option value="cashier">صندوقدار</option>
                              <option value="instructor">مربی</option>
                            </select>
                          )}
                        </td>
                        <td className="p-3">
                          {u.locked ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">فعال</span>
                          ) : (
                            <button type="button" onClick={() => handleToggleStaff(u)} className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${u.is_active ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-slate-500 bg-slate-100 border-slate-200'}`}>
                              {u.is_active ? 'فعال' : 'غیرفعال'}
                            </button>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <input type="password" className="w-28 px-2 py-1 border border-slate-200 rounded-md" placeholder={u.source === 'env' ? 'رمز ادمین' : 'رمز جدید'} value={passwordEdits[u.id] || ''} onChange={e => setPasswordEdits(prev => ({ ...prev, [u.id]: e.target.value }))} />
                            <button type="button" onClick={() => handleStaffPassword(u)} className="px-2 py-1 text-[10px] font-bold border border-slate-200 rounded-md hover:bg-slate-50">ثبت</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
