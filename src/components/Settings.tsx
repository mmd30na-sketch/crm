import React, { useState, useEffect } from 'react';
import { DEFAULT_CONTRACT_TEXT } from '../utils/printDocs';
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
  Palette,
  Sun,
  Moon,
  Monitor,
  ImagePlus,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { Course, StaffRole, StaffUser, ThemeConfig } from '../types';
import * as api from '../api/client';
import AuditBackupPanel from './AuditBackupPanel';
import { useTheme } from '../theme/ThemeProvider';

interface SettingsProps {
  courses: Course[];
  onRefresh: () => void;
}

export default function Settings({ courses, onRefresh }: SettingsProps) {
  const [activeSubTab, setActiveSubTab] = useState<'academy' | 'courses' | 'payment' | 'users' | 'gateways' | 'database' | 'theme'>('academy');

  /* ── 0. Theme («تم»): applied app-wide through the ThemeProvider, saved on the server ── */
  const { theme, setTheme } = useTheme();
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [themeSaved, setThemeSaved] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const updateTheme = (patch: Partial<ThemeConfig>) => setTheme({ ...theme, ...patch });
  const handleSaveTheme = async () => {
    setIsSavingTheme(true);
    try {
      await api.saveThemeSettings(theme);
      setThemeSaved(true);
      setTimeout(() => setThemeSaved(false), 2500);
    } catch {
      alert('خطا در ذخیره تنظیمات تم');
    } finally {
      setIsSavingTheme(false);
    }
  };
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsUploadingLogo(true);
    try {
      setTheme(await api.uploadThemeLogo(file));
    } catch (err: any) {
      alert(err?.message || 'بارگذاری لوگو ناموفق بود');
    } finally {
      setIsUploadingLogo(false);
    }
  };
  const handleLogoReset = async () => {
    try {
      setTheme(await api.saveThemeSettings({ ...theme, logo_url: null }));
    } catch {
      alert('خطا در بازگردانی لوگو');
    }
  };

  /* ── 1. Rubika & SMS gateways: stored on the server, secrets are never sent back ── */
  const [rubikaBotToken, setRubikaBotToken]   = useState('');
  const [rubikaTokenSet, setRubikaTokenSet]   = useState(false);

  const [smsProvider, setSmsProvider]                 = useState('ippanel');
  const [smsApiKey, setSmsApiKey]                     = useState('');
  const [smsKeySet, setSmsKeySet]                     = useState(false);
  const [smsSenderLine, setSmsSenderLine]             = useState('');
  const [smsAutoSendRegister, setSmsAutoSendRegister] = useState(true);

  const RUBIKA_WEBHOOK_URL = `${typeof window !== 'undefined' && /^https?:/.test(window.location.origin) ? window.location.origin : 'https://management.kermanshahcart.ir'}/api/messenger/webhook`;
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [rubikaTesting, setRubikaTesting] = useState(false);
  const [rubikaTestResult, setRubikaTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const copyWebhook = async () => {
    try { await navigator.clipboard.writeText(RUBIKA_WEBHOOK_URL); setWebhookCopied(true); setTimeout(() => setWebhookCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const handleTestRubika = async () => {
    setRubikaTesting(true); setRubikaTestResult(null);
    try {
      const r = await api.testRubikaBot();
      setRubikaTestResult(r.ok
        ? { ok: true, text: `اتصال برقرار است${r.bot?.bot_title ? ` — ${r.bot.bot_title}` : ''}${r.bot?.username ? ` (@${r.bot.username})` : ''}` }
        : { ok: false, text: r.error || 'اتصال ناموفق' });
    } catch { setRubikaTestResult({ ok: false, text: 'خطا در ارتباط با سرور' }); }
    finally { setRubikaTesting(false); }
  };
  /* Main Rubika account (rubpy) */
  const [rbAcc, setRbAcc] = useState<api.RubikaAccountStatus | null>(null);
  const [rbPhone, setRbPhone] = useState('');
  const [rbCode, setRbCode] = useState('');
  const [rbPass, setRbPass] = useState('');
  const [rbStep, setRbStep] = useState<'idle' | 'code' | 'password'>('idle');
  const [rbHint, setRbHint] = useState('');
  const [rbBusy, setRbBusy] = useState(false);
  const [rbMsg, setRbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loadRbAcc = () => api.fetchRubikaAccount().then(setRbAcc).catch(() => setRbAcc({ ok: false, error: 'خواندن وضعیت ممکن نشد' }));
  useEffect(() => { loadRbAcc(); }, []);
  const rbSendCode = async () => {
    setRbBusy(true); setRbMsg(null);
    const r = await api.rubikaAccountSendCode(rbPhone, rbStep === 'password' ? rbPass : undefined);
    setRbBusy(false);
    if (!r.ok) return setRbMsg({ ok: false, text: r.error || 'خطا' });
    if (r.step === 'password') { setRbStep('password'); setRbHint(r.hint || ''); setRbMsg({ ok: true, text: 'این حساب رمز دومرحله‌ای دارد؛ رمز را وارد و دوباره «ارسال کد» را بزنید.' }); }
    else { setRbStep('code'); setRbPass(''); setRbMsg({ ok: true, text: 'کد به روبیکا/پیامک شما ارسال شد.' }); }
  };
  const rbSignIn = async () => {
    setRbBusy(true); setRbMsg(null);
    const r = await api.rubikaAccountSignIn(rbCode);
    setRbBusy(false); setRbCode('');
    if (!r.ok) return setRbMsg({ ok: false, text: r.error || 'خطا' });
    setRbStep('idle'); setRbMsg({ ok: true, text: 'ورود موفق بود.' }); loadRbAcc();
  };
  const rbLogout = async () => {
    if (!window.confirm('از اکانت اصلی روبیکا خارج شوید؟ ارسال پیام از سایت هم متوقف می‌شود.')) return;
    setRbBusy(true); const r = await api.rubikaAccountLogout(); setRbBusy(false);
    setRbMsg({ ok: !!r.ok, text: r.ok ? (r.note || 'خارج شدید.') : (r.error || 'خطا') }); loadRbAcc();
  };
  const rbToggle = async (v: boolean) => { const r = await api.rubikaAccountSetActive(v); if (r.ok) setRbAcc(a => ({ ...(a || { ok: true }), active: v })); };
  const [isSavingGateways, setIsSavingGateways] = useState(false);
  const [gatewaysSuccess, setGatewaysSuccess]   = useState(false);
  const [gatewaysError, setGatewaysError]       = useState('');

  useEffect(() => {
    api.fetchGatewaySettings().then(g => {
      setRubikaTokenSet(!!g.rubika_bot_token_set);
      setSmsProvider(g.sms_provider === 'smsir' ? 'smsir' : 'ippanel');
      setSmsKeySet(!!g.sms_api_key_set);
      setSmsSenderLine(g.sms_sender_line || '');
      setSmsAutoSendRegister(g.sms_auto_register !== false);
    }).catch(() => setGatewaysError('خواندن تنظیمات درگاه‌ها از سرور ممکن نشد.'));
  }, []);

  const handleSaveGateways = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGateways(true); setGatewaysSuccess(false); setGatewaysError('');
    try {
      // Empty key/token fields keep the value already saved on the server.
      await api.saveGatewaySettings({
        sms_provider: smsProvider,
        sms_api_key: smsApiKey,
        sms_sender_line: smsSenderLine,
        sms_auto_register: smsAutoSendRegister,
        rubika_bot_token: rubikaBotToken,
      });
      if (smsApiKey) setSmsKeySet(true);
      if (rubikaBotToken) setRubikaTokenSet(true);
      setSmsApiKey(''); setRubikaBotToken('');
      setGatewaysSuccess(true);
      setTimeout(() => setGatewaysSuccess(false), 2500);
    } catch (err: any) {
      setGatewaysError(err?.message || 'ذخیره تنظیمات ناموفق بود.');
    } finally {
      setIsSavingGateways(false);
    }
  };

  /* ── 2. Database / server status (read-only: the connection is configured in the server environment) ── */
  const [dbMode, setDbMode] = useState<'checking' | 'mysql' | 'local' | 'offline'>('checking');

  const checkServerStatus = async () => {
    setDbMode('checking');
    try {
      const h = await api.fetchHealth();
      setDbMode(h.db === 'chabokan-mysql' ? 'mysql' : 'local');
    } catch {
      setDbMode('offline');
    }
  };
  useEffect(() => { void checkServerStatus(); }, []);

  /* ── 3. Academy Profile ── */
  const [academyName, setAcademyName]       = useState('');
  const [academyLogo, setAcademyLogo]       = useState('');
  const [academyPhone, setAcademyPhone]     = useState('');
  const [academyAddress, setAcademyAddress] = useState('');
  const [receiptHeader, setReceiptHeader]   = useState('');
  const [receiptFooter, setReceiptFooter]   = useState('');
  const [contractText, setContractText]     = useState('');
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
    { id: 1, name: 'کارتخوان', code: 'pos', active: true },
    { id: 2, name: 'کارت به کارت', code: 'card_transfer', active: true },
    { id: 3, name: 'نقدی', code: 'cash', active: true },
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
          setContractText(data.contract_text || DEFAULT_CONTRACT_TEXT);
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
        contract_text: contractText.trim() === DEFAULT_CONTRACT_TEXT.trim() ? '' : contractText,
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
    { id: 'theme', label: 'تم و ظاهر', icon: Palette, color: 'sky' },
    { id: 'courses', label: 'لیست دوره‌ها', icon: BookOpen, count: courses.length, color: 'violet' },
    { id: 'gateways', label: 'وب‌سرویس و درگاه‌ها', icon: Cpu, color: 'teal' },
    { id: 'database', label: 'دیتابیس، بکاپ و تغییرات', icon: Database, color: 'amber' },
    { id: 'payment', label: 'روش‌های پرداخت', icon: CreditCard, color: 'emerald' },
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
          <span className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg font-bold ${
            dbMode === 'mysql' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : dbMode === 'local' ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
            <CheckCircle className="w-3 h-3" />
            {dbMode === 'mysql' ? 'MySQL متصل' : dbMode === 'local' ? 'ذخیره‌سازی: فایل محلی' : dbMode === 'offline' ? 'سرور در دسترس نیست' : 'در حال بررسی...'}
          </span>
          <span className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg font-bold ${
            dbMode === 'offline' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>
            <Wifi className="w-3 h-3" />{dbMode === 'offline' ? 'API قطع' : 'API فعال'}
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
                  <input type="text" required value={academyName} placeholder="نام آموزشگاه در تنظیمات ثبت نشده" onChange={e => setAcademyName(e.target.value)}
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

                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="contract-text" className="block text-xs font-semibold text-slate-600">متن قرارداد آموزشی (هر بند در یک خط)</label>
                    <button type="button" onClick={() => setContractText(DEFAULT_CONTRACT_TEXT)}
                      className="text-[11px] font-bold text-sky-700 hover:underline cursor-pointer">بازگردانی متن پیش‌فرض</button>
                  </div>
                  <textarea id="contract-text" rows={8} value={contractText} onChange={e => setContractText(e.target.value)} dir="rtl"
                    className="w-full p-3 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-sky-400 text-slate-800 leading-relaxed" />
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    شماره‌گذاری بندها خودکار است. متغیرهای قابل استفاده:{' '}
                    <span dir="ltr" className="font-mono">{'{{student_name}} {{national_code}} {{course_title}} {{course_number}} {{tuition}} {{paid}} {{date}} {{academy_name}}'}</span>.
                    تغییر متن فقط روی قراردادهای تولیدشده بعدی اثر دارد.
                  </p>
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
              SUBTAB 1.5: THEME («تم») — MODE, PRIMARY COLOR, FONT, LOGO
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'theme' && (
            <div className="space-y-5 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Palette className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
                  تم ظاهری سیستم
                </h3>
                <span className="text-[11px] text-slate-400">تغییرات بلافاصله در کل پنل اعمال می‌شوند</span>
              </div>

              {/* Mode */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">حالت نمایش</label>
                <div className="grid grid-cols-3 gap-2 max-w-sm">
                  {([
                    { id: 'light', label: 'روشن', icon: Sun },
                    { id: 'dark', label: 'تاریک', icon: Moon },
                    { id: 'system', label: 'سیستمی', icon: Monitor },
                  ] as const).map(m => {
                    const Icon = m.icon;
                    const selected = theme.mode === m.id;
                    return (
                      <button key={m.id} type="button" onClick={() => updateTheme({ mode: m.id })}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                          selected ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                        style={selected ? { background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-dark))' } : undefined}>
                        <Icon className="w-4 h-4" />{m.label}
                      </button>
                    );
                  })}
                </div>
                {theme.mode === 'system' && (
                  <p className="text-[11px] text-slate-400 mt-1.5">حالت سیستمی با تنظیمات تاریک/روشن دستگاه شما همگام است.</p>
                )}
              </div>

              {/* Primary color */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">رنگ اصلی (برند)</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {['#0ea5e9', '#2563eb', '#14b8a6', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#334155'].map(c => {
                    const selected = theme.primary.toLowerCase() === c;
                    return (
                      <button key={c} type="button" onClick={() => updateTheme({ primary: c })} title={c}
                        className={`w-9 h-9 rounded-xl border-2 transition cursor-pointer ${selected ? 'border-slate-900 scale-110' : 'border-white shadow-sm hover:scale-105'}`}
                        style={{ background: c }} />
                    );
                  })}
                  <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-slate-400 transition" title="رنگ دلخواه">
                    <input type="color" value={theme.primary} onChange={e => updateTheme({ primary: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
                    <span className="text-[11px] font-bold text-slate-500">رنگ دلخواه</span>
                  </label>
                  <span className="text-[11px] font-mono text-slate-400" dir="ltr">{theme.primary}</span>
                </div>
              </div>

              {/* Font */}
              <div className="max-w-sm">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">فونت رابط کاربری</label>
                <select value={theme.font} onChange={e => updateTheme({ font: e.target.value as ThemeConfig['font'] })}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none font-bold text-slate-800 bg-white cursor-pointer">
                  <option value="vazirmatn" style={{ fontFamily: 'Vazirmatn' }}>وزیرمتن (پیش‌فرض)</option>
                  <option value="tahoma" style={{ fontFamily: 'Tahoma' }}>تاهوما (Tahoma)</option>
                  <option value="system" style={{ fontFamily: 'system-ui' }}>فونت سیستم (System UI)</option>
                </select>
              </div>

              {/* Logo */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">لوگو (نمایش در سایدبار و صفحه ورود)</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="h-16 w-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden">
                    {theme.logo_url ? (
                      <img src={theme.logo_url} alt="لوگو" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <Palette className="w-6 h-6 text-slate-300" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="px-3.5 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer">
                      <ImagePlus className="w-4 h-4" />
                      {isUploadingLogo ? 'در حال بارگذاری...' : 'انتخاب تصویر'}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} disabled={isUploadingLogo} />
                    </label>
                    {theme.logo_url && (
                      <button type="button" onClick={handleLogoReset}
                        className="px-3.5 py-2.5 border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer">
                        <RotateCcw className="w-4 h-4" />بازگردانی پیش‌فرض
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400">JPG، PNG یا WEBP — حداکثر ۲ مگابایت</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                {themeSaved && (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" />تم با موفقیت ذخیره شد
                  </span>
                )}
                <button type="button" onClick={handleSaveTheme} disabled={isSavingTheme}
                  className="mr-auto px-5 py-2.5 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-dark))' }}>
                  {isSavingTheme ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />ذخیره...</> : <><Upload className="w-3.5 h-3.5" />ذخیره تم</>}
                </button>
              </div>
            </div>
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
                          {c.active ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">فعال</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">غیرفعال</span>
                          )}
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

              {/* ── Rubika (bot + main account) ── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <MessageSquare className="w-4 h-4 text-violet-600" />روبیکا
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {/* Rubika Config */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 min-w-0">
                  <div className="flex items-center justify-between gap-3 font-bold text-xs text-slate-800 border-b border-slate-200/60 pb-2">
                    <span className="flex items-center gap-2 min-w-0"><MessageSquare className="w-4 h-4 shrink-0 text-violet-600" /><span className="truncate">ربات روبیکا</span></span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                      <label className="text-[11px] font-semibold text-slate-600">توکن ربات <span dir="ltr" className="text-slate-400 font-normal">(Bot Token)</span></label>
                      {rubikaTokenSet && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">ذخیره شده</span>}
                    </div>
                    <input type="password" autoComplete="off" dir="ltr" placeholder={rubikaTokenSet ? '••••••••' : 'Bot token'} value={rubikaBotToken} onChange={e => setRubikaBotToken(e.target.value)} className="w-full px-3 py-2 text-xs text-left border border-slate-200 rounded-lg font-mono bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400" />
                    {rubikaTokenSet && <p className="mt-1 text-[10px] text-slate-400">برای تغییر توکن، مقدار جدید را وارد و ذخیره کنید.</p>}
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">آدرس Webhook <span className="text-slate-400 font-normal">(در تنظیمات ربات وارد کنید)</span></label>
                    <div className="flex gap-2 min-w-0">
                      <input type="text" readOnly dir="ltr" value={RUBIKA_WEBHOOK_URL} onFocus={e => e.target.select()} className="flex-1 min-w-0 px-3 py-2 text-xs text-left border border-slate-200 rounded-lg font-mono bg-slate-100 text-slate-600 truncate" />
                      <button type="button" onClick={copyWebhook} className={`shrink-0 px-3 py-2 text-[11px] font-bold border rounded-lg cursor-pointer transition ${webhookCopied ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'}`}>{webhookCopied ? 'کپی شد ✓' : 'کپی'}</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <button type="button" onClick={handleTestRubika} disabled={rubikaTesting || !rubikaTokenSet}
                      title={rubikaTokenSet ? '' : 'ابتدا توکن را ذخیره کنید'}
                      className="shrink-0 px-3 py-2 text-[11px] font-bold rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer flex items-center gap-1.5">
                      {rubikaTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      {rubikaTesting ? 'در حال تست...' : 'تست اتصال ربات'}
                    </button>
                    {!rubikaTokenSet && <span className="text-[10px] text-slate-400">ابتدا توکن را ذخیره کنید.</span>}
                    {rubikaTestResult && <span className={`text-[11px] font-bold px-2 py-1 rounded-md break-words ${rubikaTestResult.ok ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>{rubikaTestResult.text}</span>}
                  </div>
                </div>

                {/* Rubika main account (rubpy) */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 min-w-0">
                  <div className="flex items-center justify-between gap-3 font-bold text-xs text-slate-800 border-b border-slate-200/60 pb-2">
                    <span className="flex items-center gap-2 min-w-0"><MessageSquare className="w-4 h-4 shrink-0 text-fuchsia-600" /><span className="truncate">اکانت اصلی روبیکا</span></span>
                    <label className={`shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md border cursor-pointer ${rbAcc?.active !== false ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-500 bg-slate-100 border-slate-200'}`}>
                      <input type="checkbox" className="accent-emerald-600" checked={rbAcc?.active !== false} onChange={e => rbToggle(e.target.checked)} />
                      {rbAcc?.active !== false ? 'فعال' : 'غیرفعال'}
                    </label>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 text-[11px] font-semibold ${rbAcc?.logged_in ? 'border-emerald-200 bg-emerald-50' : rbAcc === null ? 'border-slate-200 bg-white' : 'border-rose-200 bg-rose-50'}`}>
                    {rbAcc === null ? <span className="text-slate-400">در حال بررسی...</span>
                      : rbAcc.logged_in
                        ? <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-emerald-700">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <span>متصل</span>
                            <span className="text-slate-700 font-bold">{rbAcc.name || 'بدون نام'}</span>
                            {rbAcc.username && <bdi dir="ltr" className="font-mono text-slate-500">@{rbAcc.username}</bdi>}
                            {rbAcc.phone && <bdi dir="ltr" className="font-mono text-slate-500">{rbAcc.phone}</bdi>}
                          </div>
                        : <div className="flex items-center gap-2 text-rose-700"><span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />متصل نیست — برای ورود شماره موبایل را وارد کنید.</div>}
                  </div>
                  {rbAcc?.logged_in ? (
                    <>
                      <button type="button" onClick={rbLogout} disabled={rbBusy} className="px-3 py-2 text-[11px] font-bold rounded-lg border border-rose-200 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50 cursor-pointer">خروج از اکانت</button>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">شماره موبایل</label>
                        <div className="flex gap-2 min-w-0">
                          <input type="tel" dir="ltr" placeholder="09xxxxxxxxx" value={rbPhone} onChange={e => setRbPhone(e.target.value)} className="flex-1 min-w-0 px-3 py-2 text-xs text-left border border-slate-200 rounded-lg font-mono bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-200 focus:border-fuchsia-400" />
                          <button type="button" onClick={rbSendCode} disabled={rbBusy || !rbPhone.trim()} className="shrink-0 px-3 py-2 text-[11px] font-bold rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer">{rbStep === 'password' ? 'ادامه' : 'ارسال کد'}</button>
                        </div>
                      </div>
                      {rbStep === 'password' && (
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">رمز دومرحله‌ای{rbHint ? <span className="text-slate-400 font-normal"> (راهنما: <bdi>{rbHint}</bdi>)</span> : ''}</label>
                          <input type="password" autoComplete="off" dir="ltr" value={rbPass} onChange={e => setRbPass(e.target.value)} className="w-full px-3 py-2 text-xs text-left border border-slate-200 rounded-lg font-mono bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-200 focus:border-fuchsia-400" />
                        </div>
                      )}
                      {rbStep === 'code' && (
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">کد تأیید</label>
                          <div className="flex gap-2 min-w-0">
                            <input type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" value={rbCode} onChange={e => setRbCode(e.target.value)} className="flex-1 min-w-0 px-3 py-2 text-xs text-left tracking-widest border border-slate-200 rounded-lg font-mono bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400" />
                            <button type="button" onClick={rbSignIn} disabled={rbBusy || !rbCode.trim()} className="shrink-0 px-3 py-2 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer">تأیید</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {rbBusy && <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><RefreshCw className="w-3.5 h-3.5 animate-spin" />لطفاً صبر کنید...</span>}
                  {rbMsg && <span className={`block text-[11px] font-bold px-2 py-1 rounded-md break-words ${rbMsg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>{rbMsg.text}</span>}
                </div>
                </div>
              </div>

              {/* ── SMS ── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

                {/* SMS Config */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-xs text-slate-800 border-b border-slate-200/60 pb-2">
                    <Smartphone className="w-4 h-4 text-sky-600" />درگاه پیامک کشوری (SMS API)
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">وب‌سرویس فعال</label>
                    <select value={smsProvider} onChange={e => setSmsProvider(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white cursor-pointer">
                      <option value="ippanel">IPPANEL (فراز اس‌ام‌اس)</option>
                      <option value="smsir">sms.ir</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">کلید API{smsKeySet && <span className="text-emerald-600 font-bold mr-1">— ذخیره شده (برای تغییر، مقدار جدید بنویسید)</span>}</label>
                    <input type="password" autoComplete="off" dir="ltr" value={smsApiKey} onChange={e => setSmsApiKey(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                  </div>
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={smsAutoSendRegister} onChange={e => setSmsAutoSendRegister(e.target.checked)} />
                    ارسال پیامک خوش‌آمدگویی بعد از هر ثبت‌نام
                  </label>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">خط اختصاصی ارسال</label>
                    <input type="text" dir="ltr" value={smsSenderLine} onChange={e => setSmsSenderLine(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono bg-white" />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-between items-center pt-3 border-t border-slate-100">
                {gatewaysError && <span role="alert" className="text-xs font-bold text-rose-600">{gatewaysError}</span>}
                {gatewaysSuccess && (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" />تنظیمات درگاه‌ها ذخیره شد
                  </span>
                )}
                <button type="submit" disabled={isSavingGateways}
                  className="mr-auto px-5 py-2.5 bg-gradient-to-l from-teal-600 to-teal-500 hover:from-teal-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer">
                  {isSavingGateways ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />ذخیره...</> : <><Save className="w-3.5 h-3.5" />ذخیره درگاه‌ها</>}
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
                  <Database className="w-4 h-4 text-amber-600" />دیتابیس، بکاپ و گزارش تغییرات
                </h3>
              </div>
              <p className="text-xs text-slate-500 leading-6 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                CRM به MySQL محلی سرور (<span className="font-mono">nodejs430_carla</span>) وصل است؛ Directus هم همین دیتابیس را می‌خواند.
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between font-bold">
                  <span className="text-slate-600">وضعیت ذخیره‌سازی:</span>
                  {dbMode === 'mysql' ? (
                    <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">متصل به MySQL</span>
                  ) : dbMode === 'local' ? (
                    <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">فایل محلی روی سرور (db_store.json)</span>
                  ) : dbMode === 'offline' ? (
                    <span className="text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">سرور پاسخ نمی‌دهد</span>
                  ) : (
                    <span className="text-slate-500 bg-slate-200 px-2 py-0.5 rounded-md">در حال بررسی...</span>
                  )}
                </div>
                {dbMode === 'local' && (
                  <p className="text-[11px] text-slate-500 leading-6">
                    رمز <span className="font-mono">DB_PASSWORD</span> در تنظیمات محیط سرور (فایل <span className="font-mono">.env</span>) خالی است، پس داده‌ها فقط در فایل محلی ذخیره می‌شوند و با MySQL مشترک همگام نیستند.
                  </p>
                )}
                <button onClick={checkServerStatus} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg transition cursor-pointer">
                  بررسی دوباره اتصال
                </button>
              </div>
              <AuditBackupPanel />
            </div>
          )}

          {/* ══════════════════════════════════════════════
              SUBTAB 5: PAYMENT METHODS
          ══════════════════════════════════════════════ */}
          {activeSubTab === 'payment' && (
            <div className="space-y-4 fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-600" />روش‌های دریافت وجه
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {paymentMethods.map(m => (
                  <div key={m.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                    <div className="text-xs font-bold text-slate-800">{m.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">شناسه: {m.code}</div>
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
                          {u.locked && <span className="mr-2 text-[10px] text-slate-400">سیستمی</span>}
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
