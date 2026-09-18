import React, { useState, useEffect, useMemo } from 'react';
import {
  MessageSquare,
  Send,
  Smartphone,
  Users,
  CheckCircle,
  AlertCircle,
  FileText,
  Clock,
  Sparkles,
  Inbox,
  Filter,
  Trash2,
  Check,
  Search,
  Zap,
  Radio,
  User,
  Phone,
  Paperclip,
  CheckCheck,
  ShieldCheck,
  RefreshCw,
  Plus,
  Tag,
} from 'lucide-react';
import { Student } from '../types';
import * as api from '../api/client';

interface MessengerHubProps {
  students: Student[];
  onRefresh: () => void;
}

interface ChatThread {
  id: number;
  studentId?: number;
  senderName: string;
  avatar: string;
  courseTitle: string;
  phone: string;
  channel: 'rubika' | 'bale' | 'eitaa' | 'sms';
  lastMessage: string;
  time: string;
  unreadCount: number;
  messages: Array<{
    id: number;
    sender: 'student' | 'system' | 'admin';
    text: string;
    time: string;
    status: 'sent' | 'delivered' | 'read';
  }>;
}

interface SmsLog {
  id: number;
  recipientName: string;
  phoneNumber: string;
  text: string;
  templateTitle: string;
  time: string;
  status: 'delivered' | 'sent' | 'pending';
}

const QUICK_TEMPLATES = [
  {
    id: 'welcome',
    title: 'خوش‌آمدگویی و ثبت‌نام',
    body: 'هنرجوی گرامی [نام] [خانوادگی]؛ ثبت‌نام شما در دوره [دوره] با موفقیت انجام شد. کلاس‌های آیین‌نامه از شنبه شروع می‌شود. کارلا CRM',
    color: 'sky',
  },
  {
    id: 'debt_warning',
    title: 'یادآوری بدهی مالی',
    body: 'کارآموز گرامی [نام]؛ با توجه به نزدیک شدن زمان آزمون، خواهشمند است نسبت به تسویه مانده بدهی [بدهی] اقدام فرمایید. آموزشگاه کارلا',
    color: 'rose',
  },
  {
    id: 'exam_schedule',
    title: 'زمان‌بندی آزمون',
    body: 'هنرجو [نام] [خانوادگی]؛ آزمون عملی رانندگی شما برای روز [تاریخ] ساعت [ساعت] برنامه‌ریزی شد. همراه داشتن کارت ملی الزامی است.',
    color: 'teal',
  },
  {
    id: 'class_change',
    title: 'تغییر زمان کلاس عملی',
    body: 'هنرجوی گرامی [نام]؛ جلسه کلاس عملی رانندگی شما تغییر یافت. جهت هماهنگی زمان جدید با مربی تماس بگیرید.',
    color: 'amber',
  },
];

export default function MessengerHub({ students, onRefresh }: MessengerHubProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'sms' | 'templates'>('chat');

  /* ── Real Rubika Chat Threads ── */
  const REAL_RUBIKA_THREADS: ChatThread[] = [
    {
      id: 1,
      senderName: "آموزشگاه کرمانشاه (دوره تیر)",
      avatar: "https://images.unsplash.com/photo-1577563908411-5077b6dc7624?w=100&auto=format&fit=crop&q=80",
      courseTitle: "کانال عمومی",
      phone: "c0DpoJd08a9a9c44d0acc2fb90659d52",
      channel: "rubika",
      lastMessage: "ساعت برگزاری کلاس دوره باری: پنجشنبه ساعت ۸:۰۰ محل برگزاری: پایانه باربری",
      time: "دیروز",
      unreadCount: 0,
      messages: [
        { id: 101, sender: "student", text: "ساعت برگزاری کلاس دوره باری: پنجشنبه ساعت ۸:۰۰ محل برگزاری: پایانه باربری", time: "دیروز", status: "read" }
      ]
    },
    {
      id: 2,
      senderName: "ک۲ مسعود شمس زاد",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
      courseTitle: "هنرجو ثبت‌نامی",
      phone: "u0rbv70bbc813f8dc0cd84a4cb6b8035",
      channel: "rubika",
      lastMessage: "سلام اطلاع میدم",
      time: "۱۴:۳۵",
      unreadCount: 0,
      messages: [
        { id: 201, sender: "admin", text: "سلام آقای شمس زاد، مدارک کامل شد؟", time: "۱۴:۲۰", status: "read" },
        { id: 202, sender: "student", text: "سلام اطلاع میدم", time: "۱۴:۳۵", status: "read" }
      ]
    },
    {
      id: 3,
      senderName: "ک۲ پارسیان طیب",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80",
      courseTitle: "هنرجو ثبت‌نامی",
      phone: "u0HUIDu08ce0ccedf78aa6bb85b26c28",
      channel: "rubika",
      lastMessage: "تصویر مدارک ارسال شد",
      time: "دیروز",
      unreadCount: 0,
      messages: [
        { id: 301, sender: "student", text: "تصویر مدارک ارسال شد", time: "دیروز", status: "read" }
      ]
    },
    {
      id: 4,
      senderName: "sina mhmdi 2",
      avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&auto=format&fit=crop&q=80",
      courseTitle: "کاربر روبیکا",
      phone: "u0KPTf3065a6168bcd4df7c138eff0b7",
      channel: "rubika",
      lastMessage: "به روبیکا پیوست.",
      time: "پریروز",
      unreadCount: 0,
      messages: [
        { id: 401, sender: "system", text: "سینا محمدی به روبیکا پیوست.", time: "پریروز", status: "read" }
      ]
    },
    {
      id: 5,
      senderName: "آموزشگاه کرمانشاه (دوره اردیبهشت)",
      avatar: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=100&auto=format&fit=crop&q=80",
      courseTitle: "کانال دوره اردیبهشت",
      phone: "c0D59vX00cf41f209ab4a34faee18473",
      channel: "rubika",
      lastMessage: "آزمون عملی روز شنبه ساعت ۹ صبح هست. آدرس: سه راه حافظیه...",
      time: "۱۴۰۳/۰۴/۱۲",
      unreadCount: 0,
      messages: [
        { id: 501, sender: "student", text: "آزمون عملی روز شنبه ساعت ۹ صبح هست. آدرس: سه راه حافظیه دور برگردان دوم آموزش فنی وحرفه‌ای", time: "۱۴۰۳/۰۴/۱۲", status: "read" }
      ]
    },
    {
      id: 6,
      senderName: "بات رهنورد",
      avatar: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=80",
      courseTitle: "ربات هوشمند",
      phone: "b09GZ026f219aa825226d95bb2b29e23",
      channel: "rubika",
      lastMessage: "سوال 10 از 52: شرکت‌ها و موسسات حمل و نقل جاده‌ای...",
      time: "۱۴۰۳/۰۴/۱۰",
      unreadCount: 0,
      messages: [
        { id: 601, sender: "student", text: "📊 ❓ سوال 10 از 52: شرکت‌ها و موسسات حمل و نقل جاده‌ای فقط جهت وسایل نقلیه‌ای باید بارنامه یا صورت وضعیت صادر نمایند؟", time: "۱۴۰۳/۰۴/۱۰", status: "read" }
      ]
    },
    {
      id: 7,
      senderName: "نمونه سئوالات کارت هوشمند",
      avatar: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=100&auto=format&fit=crop&q=80",
      courseTitle: "کانال آموزشی",
      phone: "c0DJaY10a60405e14a73553430cf50f5",
      channel: "rubika",
      lastMessage: "با سلام و احترام آزمون عملی هنر جوها دوشنبه ۳۱ فروردین...",
      time: "۱۴۰۳/۰۳/۲۵",
      unreadCount: 0,
      messages: [
        { id: 701, sender: "student", text: "با سلام و احترام آزمون عملی هنر جوها دوشنبه ۳۱ فروردین ساعت ۱۰ صبح محل آزمون سازمان آموزش فنی و حرفه‌ای", time: "۱۴۰۳/۰۳/۲۵", status: "read" }
      ]
    }
  ];

  /* ── Initial Chat Threads State ── */
  const [threads, setThreads] = useState<ChatThread[]>(() => REAL_RUBIKA_THREADS);

  // Sync real messages and threads from backend API
  useEffect(() => {
    const loadRealMessages = async () => {
      try {
        const [rawMsgs, realThreads] = await Promise.all([
          api.fetchMessengerMessages(),
          api.fetchMessengerThreads(),
        ]);

        setThreads(prevThreads => {
          const updated = [...prevThreads];

          if (realThreads && realThreads.length > 0) {
            for (const rTh of realThreads) {
              const exists = updated.find(t => t.id === rTh.thread_id || t.senderName === rTh.title);
              if (!exists) {
                updated.unshift({
                  id: rTh.thread_id || Date.now(),
                  senderName: rTh.title || 'کاربر روبیکا',
                  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
                  courseTitle: 'چت عمومی',
                  phone: rTh.external_id || '09120000000',
                  channel: (rTh.channel as any) || 'rubika',
                  lastMessage: rTh.last_message_text || 'سلام، پیام دریافت شد.',
                  time: rTh.updated_at ? new Date(rTh.updated_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '۱۰:۰۰',
                  unreadCount: rTh.unread_count || 0,
                  messages: [
                    {
                      id: Date.now() + Math.random(),
                      sender: 'student',
                      text: rTh.last_message_text || 'سلام، وضعیت پرونده من به چه صورت است؟',
                      time: '۱۰:۰۰',
                      status: 'read',
                    },
                  ],
                });
              }
            }
          }

          if (rawMsgs && rawMsgs.length > 0) {
            for (const msg of rawMsgs) {
              const phone = String(msg.sender_phone || msg.phone || '').replace(/^\+98/, '0');
              let targetThread = updated.find(t => t.phone === phone || t.senderName.includes(msg.sender));
              if (targetThread) {
                const exists = targetThread.messages.some(m => m.id === msg.id);
                if (!exists) {
                  targetThread.messages.push({
                    id: msg.id || Date.now(),
                    sender: msg.sender === 'admin' ? 'admin' : 'student',
                    text: msg.message,
                    time: msg.received_at ? new Date(msg.received_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : 'هم‌اکنون',
                    status: 'read',
                  });
                  targetThread.lastMessage = msg.message;
                  targetThread.time = 'هم‌اکنون';
                }
              } else if (msg.sender || msg.message) {
                // Add new thread for unknown sender
                updated.unshift({
                  id: msg.id || Date.now(),
                  senderName: msg.sender || 'کاربر روبیکا',
                  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
                  courseTitle: 'پیام ورودی',
                  phone: phone || '09120000000',
                  channel: (msg.channel as any) || 'rubika',
                  lastMessage: msg.message,
                  time: 'هم‌اکنون',
                  unreadCount: 1,
                  messages: [{
                    id: msg.id || Date.now(),
                    sender: 'student',
                    text: msg.message,
                    time: 'هم‌اکنون',
                    status: 'read',
                  }]
                });
              }
            }
          }
          return updated;
        });
      } catch (err) {
        console.warn('Error syncing real messages:', err);
      }
    };

    loadRealMessages();
    const interval = setInterval(loadRealMessages, 5000);
    return () => clearInterval(interval);
  }, []);

  const [activeThreadId, setActiveThreadId] = useState<number>(1);
  const [chatSearch, setChatSearch]         = useState('');
  const [messageInput, setMessageInput]     = useState('');
  const [channelFilter, setChannelFilter]   = useState<string>('all');

  /* ── SMS Form States ── */
  const [smsRecipientStudentId, setSmsRecipientStudentId] = useState<string>('');
  const [smsCustomPhone, setSmsCustomPhone]               = useState('');
  const [selectedTemplateId, setSelectedTemplateId]       = useState('');
  const [smsBody, setSmsBody]                             = useState('');
  const [isSendingSms, setIsSendingSms]                   = useState(false);
  const [smsSuccessToast, setSmsSuccessToast]             = useState('');

  const [smsLogs, setSmsLogs] = useState<SmsLog[]>(() => [
    { id: 1, recipientName: 'امیرحسین رضایی', phoneNumber: '09123456789', text: 'هنرجوی گرامی امیرحسین رضایی؛ ثبت‌نام شما در دوره پایه سوم با موفقیت انجام شد.', templateTitle: 'خوش‌آمدگویی', time: '۱۴۰۵/۰۵/۲۸ - ۱۱:۱۵', status: 'delivered' },
    { id: 2, recipientName: 'سارا احمدی', phoneNumber: '09198765432', text: 'کارآموز گرامی سارا احمدی؛ آزمون عملی شما برای شنبه ساعت ۱۰:۰۰ تنظیم گردید.', templateTitle: 'زمان‌بندی آزمون', time: '۱۴۰۵/۰۵/۲۷ - ۰۹:۳۰', status: 'delivered' },
  ]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeThreadId) ?? threads[0], [threads, activeThreadId]);

  /* Filter threads */
  const filteredThreads = useMemo(() => threads.filter(t => {
    const q = chatSearch.toLowerCase();
    const matchSearch = t.senderName.toLowerCase().includes(q) || t.phone.includes(q) || t.courseTitle.toLowerCase().includes(q);
    const matchChan   = channelFilter === 'all' || t.channel === channelFilter;
    return matchSearch && matchChan;
  }), [threads, chatSearch, channelFilter]);

  /* Total unread count */
  const totalUnread = useMemo(() => threads.reduce((acc, t) => acc + t.unreadCount, 0), [threads]);

  /* Send message in chat thread */
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !activeThread) return;
    const textToSend = messageInput.trim();
    const newMsg = {
      id: Date.now(),
      sender: 'admin' as const,
      text: textToSend,
      time: 'هم‌اکنون',
      status: 'delivered' as const,
    };
    setThreads(prev => prev.map(t => {
      if (t.id === activeThread.id) {
        return {
          ...t,
          lastMessage: newMsg.text,
          time: 'هم‌اکنون',
          unreadCount: 0,
          messages: [...t.messages, newMsg],
        };
      }
      return t;
    }));
    setMessageInput('');

    // Real API Call to Backend Server /api/messenger/send
    try {
      await api.sendMessengerMessage({
        channel: activeThread.channel,
        recipient: activeThread.phone,
        messageText: textToSend,
      });
    } catch (e) {
        console.warn('Real API messenger send fallback:', e);
    }
  };

  /* Fill SMS from template */
  useEffect(() => {
    if (selectedTemplateId) {
      const tmpl = QUICK_TEMPLATES.find(t => t.id === selectedTemplateId);
      if (tmpl) {
        let text = tmpl.body;
        if (smsRecipientStudentId) {
          const st = students.find(s => s.id.toString() === smsRecipientStudentId);
          if (st) {
            text = text
              .replace('[نام]', st.first_name)
              .replace('[خانوادگی]', st.last_name)
              .replace('[دوره]', 'پایه سوم')
              .replace('[بدهی]', '۲,۵۰۰,۰۰۰ تومان')
              .replace('[تاریخ]', '۱۴۰۵/۰۶/۰۵')
              .replace('[ساعت]', '۱۰:۰۰');
            setSmsCustomPhone(st.phone_number || '');
          }
        }
        setSmsBody(text);
      }
    }
  }, [selectedTemplateId, smsRecipientStudentId, students]);

  /* Send SMS Action */
  const handleSendSms = (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsBody.trim()) return;

    let rName = 'شماره دستی';
    let rPhone = smsCustomPhone || '—';

    if (smsRecipientStudentId) {
      const st = students.find(s => s.id.toString() === smsRecipientStudentId);
      if (st) {
        rName = `${st.first_name} ${st.last_name}`;
        rPhone = st.phone_number || smsCustomPhone;
      }
    }

    setIsSendingSms(true);
    setTimeout(() => {
      const log: SmsLog = {
        id: Date.now(),
        recipientName: rName,
        phoneNumber: rPhone,
        text: smsBody,
        templateTitle: QUICK_TEMPLATES.find(t => t.id === selectedTemplateId)?.title || 'متن دلخواه',
        time: '۱۴۰۵/۰۵/۲۸ - ۱۳:۵۰',
        status: 'delivered',
      };
      setSmsLogs(prev => [log, ...prev]);
      setIsSendingSms(false);
      setSmsSuccessToast(`پیامک با موفقیت به ${rPhone} ارسال شد.`);
      setSmsBody(''); setSelectedTemplateId(''); setSmsRecipientStudentId(''); setSmsCustomPhone('');
      setTimeout(() => setSmsSuccessToast(''), 3500);
    }, 1000);
  };

  /* Channel Badge Component */
  const ChannelBadge = ({ channel }: { channel: ChatThread['channel'] }) => {
    const map = {
      rubika: { label: 'روبیکا', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
      bale:   { label: 'بله',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      eitaa:  { label: 'ایتا',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
      sms:    { label: 'پیامک', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    };
    return <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${map[channel].cls}`}>{map[channel].label}</span>;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm fade-in" id="messenger-hub-root" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>

      {/* ══════════════════════════════════════════════
          TOP HEADER — LIGHT CORPORATE NAVIGATION
      ══════════════════════════════════════════════ */}
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-sky-50/70 via-white to-slate-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white flex items-center justify-center shadow-md shadow-sky-200">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900">مرکز ارتباطی و پیام‌رسان کارلا</h2>
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                <Radio className="w-2.5 h-2.5 text-emerald-500 animate-pulse" />درگاه متصل
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">مدیریت گفتگوهای روبیکا، بله، ایتا و پنل پیامک انبوه کشوری</p>
          </div>
        </div>

        {/* Tab Switchers */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition cursor-pointer ${
              activeTab === 'chat' ? 'bg-white text-sky-700 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-sky-500" />
            گفتگوهای زنده
            {totalUnread > 0 && (
              <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                {totalUnread}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('sms')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition cursor-pointer ${
              activeTab === 'sms' ? 'bg-white text-sky-700 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Smartphone className="w-4 h-4 text-emerald-500" />
            ارسال پیامک (SMS)
          </button>

          <button
            onClick={() => setActiveTab('templates')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition cursor-pointer ${
              activeTab === 'templates' ? 'bg-white text-sky-700 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Tag className="w-4 h-4 text-amber-500" />
            الگوهای آماده
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          TAB 1: LIVE CHAT MESSENGER (MODERN CONSOLE)
      ══════════════════════════════════════════════ */}
      {activeTab === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-100 min-h-[520px]" id="chat-sub-panel">

          {/* ─── Left Sidebar: Thread List (5 cols) ─── */}
          <div className="lg:col-span-4 bg-slate-50/50 flex flex-col justify-between">
            {/* Search & Channel Filter Bar */}
            <div className="p-3 border-b border-slate-100 space-y-2 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="جستجوی گفتگوی هنرجو..."
                  value={chatSearch}
                  onChange={e => setChatSearch(e.target.value)}
                  className="w-full pr-8 pl-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-sky-400 focus:bg-white transition"
                />
              </div>

              {/* Channels filter pills */}
              <div className="flex gap-1 overflow-x-auto text-[10px] font-semibold pt-1">
                {[
                  { id: 'all', label: 'همه' },
                  { id: 'rubika', label: 'روبیکا' },
                  { id: 'bale', label: 'بله' },
                  { id: 'eitaa', label: 'ایتا' },
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => setChannelFilter(item.id)}
                    className={`px-2.5 py-1 rounded-lg border transition whitespace-nowrap cursor-pointer ${
                      channelFilter === item.id
                        ? 'bg-sky-600 text-white border-sky-600 font-bold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Thread Cards Scroll List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {filteredThreads.map(thread => {
                const isSelected = activeThread.id === thread.id;
                return (
                  <button
                    key={thread.id}
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, unreadCount: 0 } : t));
                    }}
                    className={`w-full p-3.5 text-right transition-all flex items-start gap-3 border-r-4 cursor-pointer ${
                      isSelected
                        ? 'bg-sky-50/80 border-sky-500 text-slate-900 shadow-2xs'
                        : 'bg-transparent border-transparent hover:bg-white text-slate-700'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <img src={thread.avatar} alt="" className="w-10 h-10 rounded-xl object-cover border border-slate-200" />
                      {thread.unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center ring-2 ring-white">
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-xs font-bold truncate ${isSelected ? 'text-sky-900' : 'text-slate-800'}`}>
                          {thread.senderName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">{thread.time}</span>
                      </div>

                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[10px] text-slate-400 truncate">{thread.courseTitle}</span>
                        <ChannelBadge channel={thread.channel} />
                      </div>

                      <p className={`text-xs truncate ${thread.unreadCount > 0 ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
                        {thread.lastMessage}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer Summary */}
            <div className="p-3 border-t border-slate-200 bg-white text-[10px] text-slate-400 flex justify-between items-center">
              <span>{threads.length} گفتگوی فعال</span>
              <span className="text-emerald-600 font-bold">همگام با CRM</span>
            </div>
          </div>

          {/* ─── Right Pane: Active Chat Area (7 cols) ─── */}
          <div className="lg:col-span-8 flex flex-col justify-between bg-white min-h-[500px]">
            {activeThread ? (
              <>
                {/* Active Chat Header Bar */}
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={activeThread.avatar} alt="" className="w-9 h-9 rounded-xl object-cover border border-slate-200" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold text-slate-900">{activeThread.senderName}</h3>
                        <ChannelBadge channel={activeThread.channel} />
                      </div>
                      <p className="text-[10px] text-slate-400">{activeThread.courseTitle} — {activeThread.phone}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-md">
                      پرونده #{activeThread.studentId ?? '۱۰۱'}
                    </span>
                  </div>
                </div>

                {/* Chat Messages Stream Area */}
                <div className="p-5 flex-1 overflow-y-auto space-y-3 bg-gradient-to-b from-slate-50/30 to-white">
                  <div className="text-center my-2">
                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                      امروز — پیوند پیام‌رسان {activeThread.channel}
                    </span>
                  </div>

                  {activeThread.messages.map(msg => {
                    const isStudent = msg.sender === 'student';
                    return (
                      <div
                        key={msg.id}
                        className={`flex items-start gap-2.5 max-w-[80%] ${isStudent ? 'mr-0 ml-auto flex-row' : 'ml-0 mr-auto flex-row-reverse'}`}
                      >
                        {isStudent ? (
                          <img src={activeThread.avatar} alt="" className="w-7 h-7 rounded-lg object-cover border border-slate-200 mt-1 shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-lg bg-sky-600 text-white font-bold text-[10px] flex items-center justify-center mt-1 shrink-0 shadow-xs">
                            کارلا
                          </div>
                        )}

                        <div>
                          <div className={`flex items-center gap-1.5 mb-1 ${isStudent ? '' : 'justify-end'}`}>
                            <span className="text-[10px] font-bold text-slate-700">
                              {isStudent ? activeThread.senderName : 'اپراتور پذیرش'}
                            </span>
                            <span className="text-[9px] text-slate-400 font-mono">{msg.time}</span>
                          </div>

                          <div
                            className={`p-3 rounded-2xl text-xs leading-relaxed shadow-xs ${
                              isStudent
                                ? 'bg-slate-100 text-slate-800 rounded-tr-none'
                                : 'bg-gradient-to-l from-sky-600 to-sky-500 text-white rounded-tl-none font-medium'
                            }`}
                          >
                            {msg.text}
                          </div>

                          {!isStudent && (
                            <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-emerald-600 font-bold">
                              <CheckCheck className="w-3 h-3" />تحویل داده شد
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Chat Input Bar */}
                <div className="p-3 border-t border-slate-100 bg-slate-50/50">
                  {/* Quick Template Chips */}
                  <div className="flex gap-1.5 overflow-x-auto pb-2 text-[10px]">
                    <span className="text-slate-400 font-semibold py-1 shrink-0">پاسخ‌های آماده:</span>
                    {QUICK_TEMPLATES.map(tmpl => (
                      <button
                        key={tmpl.id}
                        onClick={() => setMessageInput(tmpl.body.replace('[نام]', activeThread.senderName))}
                        className="px-2.5 py-1 bg-white hover:bg-sky-50 text-slate-700 hover:text-sky-700 border border-slate-200 rounded-lg whitespace-nowrap transition cursor-pointer font-medium"
                      >
                        {tmpl.title}
                      </button>
                    ))}
                  </div>

                  {/* Input Form */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={`پاسخ به ${activeThread.senderName}...`}
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                      className="flex-1 px-4 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!messageInput.trim()}
                      className="px-4 py-2 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      ارسال
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-10">
                <Inbox className="w-12 h-12 mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-600">یک گفتگو را انتخاب کنید</p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB 2: SMS GATEWAY BROADCAST PANEL
      ══════════════════════════════════════════════ */}
      {activeTab === 'sms' && (
        <div className="p-6 fade-in" id="sms-sub-panel">
          {/* Toast */}
          {smsSuccessToast && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2 shadow-xs">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              {smsSuccessToast}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Left: SMS Send Form (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <Smartphone className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">ارسال پیامک از طریق درگاه کشوری (Pattern SMS)</h3>
              </div>

              <form onSubmit={handleSendSms} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Select Student */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">انتخاب هنرجو از دفترچه پرونده‌ها</label>
                    <div className="relative">
                      <User className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                        value={smsRecipientStudentId}
                        onChange={e => setSmsRecipientStudentId(e.target.value)}
                        className="w-full pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-sky-400 transition cursor-pointer"
                      >
                        <option value="">-- شماره آزاد / دستی --</option>
                        {students.map(s => (
                          <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.phone_number})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Select Template */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">الگوهای آماده هوشمند</label>
                    <div className="relative">
                      <Tag className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                        value={selectedTemplateId}
                        onChange={e => setSelectedTemplateId(e.target.value)}
                        className="w-full pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-sky-400 transition cursor-pointer"
                      >
                        <option value="">-- بدون الگو (نوشتن دستی) --</option>
                        {QUICK_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Custom Phone Number */}
                {!smsRecipientStudentId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">شماره همراه گیرنده</label>
                    <div className="relative">
                      <Phone className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="0912xxxxxxx"
                        value={smsCustomPhone}
                        onChange={e => setSmsCustomPhone(e.target.value)}
                        className="w-full pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-xl font-mono focus:outline-none focus:border-sky-400"
                      />
                    </div>
                  </div>
                )}

                {/* Text Body */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-semibold text-slate-600">متن پیامک (فارسی)</label>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {smsBody.length} کاراکتر / {Math.ceil(smsBody.length / 70) || 1} صفحه پیامک
                    </span>
                  </div>
                  <textarea
                    required
                    rows={4}
                    value={smsBody}
                    onChange={e => setSmsBody(e.target.value)}
                    placeholder="متن پیامک را اینجا وارد کنید..."
                    className="w-full p-3 text-xs border border-slate-200 rounded-xl leading-relaxed focus:outline-none focus:border-sky-400 resize-none"
                  />
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isSendingSms || !smsBody.trim()}
                  className="w-full py-2.5 bg-gradient-to-l from-sky-600 to-sky-500 hover:from-sky-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  {isSendingSms ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />در حال ارسال از درگاه...</>
                  ) : (
                    <><Send className="w-4 h-4" />ارسال فوری پیامک تحت درگاه</>
                  )}
                </button>
              </form>
            </div>

            {/* Right: Gateway Config & Recent SMS Logs (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              {/* Gateway config box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-500" />وضعیت درگاه پیامکی</span>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">IPPanel Active</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
                  <div className="bg-white p-2 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block mb-0.5">خط اختصاصی:</span>
                    <span className="font-mono font-bold text-slate-700">5000400070</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block mb-0.5">اعتبار پنل:</span>
                    <span className="font-mono font-bold text-emerald-600">۴,۲۵۰,۰۰۰ تومان</span>
                  </div>
                </div>
              </div>

              {/* Logs */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-700">آخرین ارسالی‌های وب‌سرویس</span>
                  <span className="text-[10px] font-bold text-slate-400 font-mono">{smsLogs.length} ثبت شده</span>
                </div>

                <div className="space-y-2 max-h-[260px] overflow-y-auto">
                  {smsLogs.map(log => (
                    <div key={log.id} className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-800">{log.recipientName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{log.time}</span>
                      </div>
                      <p className="text-slate-600 text-[11px] leading-relaxed line-clamp-2">{log.text}</p>
                      <div className="flex justify-between items-center pt-1 border-t border-slate-200/60 text-[10px]">
                        <span className="text-slate-400 font-medium">{log.templateTitle}</span>
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-500" />رسیده به مقصد
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB 3: QUICK TEMPLATES MANAGEMENT
      ══════════════════════════════════════════════ */}
      {activeTab === 'templates' && (
        <div className="p-6 space-y-4 fade-in" id="templates-sub-panel">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">مدیریت الگوهای آماده ارسال</h3>
              <p className="text-xs text-slate-400">قالب‌های استاندارد اطلاع‌رسانی به کارآموزان جهت استفاده در درگاه</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {QUICK_TEMPLATES.map(tmpl => (
              <div key={tmpl.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5 shadow-xs hover:border-sky-300 transition">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-sky-500" />{tmpl.title}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">ID: {tmpl.id}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {tmpl.body}
                </p>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => {
                      setSelectedTemplateId(tmpl.id);
                      setSmsBody(tmpl.body);
                      setActiveTab('sms');
                    }}
                    className="px-3 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold rounded-lg transition cursor-pointer"
                  >
                    استفاده در ارسال پیامک
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
