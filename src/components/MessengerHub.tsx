import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  User,
  Phone,
  Paperclip,
  CheckCheck,
  RefreshCw,
  Plus,
  Tag,
} from 'lucide-react';
import { Student, Course, Enrollment, Payment } from '../types';
import * as api from '../api/client';
import { studentBalance } from '../utils/finance';

interface MessengerHubProps {
  students: Student[];
  courses?: Course[];
  enrollments?: Enrollment[];
  payments?: Payment[];
  onRefresh: () => void;
}

const digitsOnly = (v: unknown) => String(v ?? '')
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/\D/g, '');
const phoneKey = (v: unknown) => digitsOnly(v).replace(/^98/, '0').replace(/^9(?=\d{9}$)/, '09');

function Avatar({ name, className }: { name: string; className: string }) {
  return (
    <div className={`${className} bg-sky-100 text-sky-700 font-black flex items-center justify-center shrink-0`}>
      {(name || '?').trim().charAt(0)}
    </div>
  );
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
    status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
    error?: string;
  }>;
}

interface SmsLog {
  id: number;
  recipientName: string;
  phoneNumber: string;
  text: string;
  templateTitle: string;
  time: string;
  status: 'delivered' | 'sent' | 'pending' | 'failed';
  error?: string;
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

export default function MessengerHub({ students, courses = [], enrollments = [], payments = [], onRefresh }: MessengerHubProps) {
  const studentsRef = useRef(students);
  studentsRef.current = students;
  const [activeTab, setActiveTab] = useState<'chat' | 'sms' | 'templates'>('chat');

  const [threads, setThreads] = useState<ChatThread[]>([]);


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
                  avatar: '',
                  courseTitle: 'چت عمومی',
                  phone: rTh.external_id || '',
                  channel: (rTh.channel as any) || 'rubika',
                  lastMessage: rTh.last_message_text || '',
                  time: rTh.updated_at ? new Date(rTh.updated_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '',
                  unreadCount: rTh.unread_count || 0,
                  messages: rTh.last_message_text ? [
                    {
                      id: Date.now() + Math.random(),
                      sender: 'student' as const,
                      text: rTh.last_message_text,
                      time: '',
                      status: 'read' as const,
                    },
                  ] : [],
                });
              }
            }
          }

          if (rawMsgs && rawMsgs.length > 0) {
            for (const msg of rawMsgs) {
              const phone = phoneKey(msg.sender_phone || msg.phone);
              const isAdminMsg = msg.sender === 'admin';
              const known = phone ? studentsRef.current.find(st => phoneKey(st.phone_number) === phone) : undefined;
              let targetThread = updated.find(t => (phone && phoneKey(t.phone) === phone) || (!isAdminMsg && msg.sender && t.senderName.includes(msg.sender)));
              if (targetThread) {
                const exists = targetThread.messages.some(m => m.id === msg.id);
                if (!exists) {
                  const pending = isAdminMsg ? targetThread.messages.find(m => m.sender === 'admin' && m.status === 'sending' && m.text === msg.message) : undefined;
                  if (pending) {
                    pending.id = msg.id; pending.status = msg.status === 'sent' ? 'sent' : pending.status;
                  } else {
                    targetThread.messages.push({
                      id: msg.id || Date.now(),
                      sender: isAdminMsg ? 'admin' : 'student',
                      text: msg.message,
                      time: msg.received_at ? new Date(msg.received_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : 'هم‌اکنون',
                      status: isAdminMsg ? (msg.status === 'sent' ? 'sent' : msg.status ? 'failed' : 'sent') : 'read',
                    });
                  }
                  targetThread.lastMessage = msg.message;
                  targetThread.time = 'هم‌اکنون';
                }
              } else if (msg.sender || msg.message) {
                // Add new thread for unknown sender
                updated.unshift({
                  id: msg.id || Date.now(),
                  studentId: known?.id,
                  senderName: known ? `${known.first_name} ${known.last_name}` : (isAdminMsg ? (phone || 'گیرنده') : msg.sender) || 'کاربر روبیکا',
                  avatar: '',
                  courseTitle: isAdminMsg ? 'پیام ارسالی' : 'پیام ورودی',
                  phone: phone || '',
                  channel: (msg.channel as any) || 'rubika',
                  lastMessage: msg.message,
                  time: 'هم‌اکنون',
                  unreadCount: isAdminMsg ? 0 : 1,
                  messages: [{
                    id: msg.id || Date.now(),
                    sender: isAdminMsg ? 'admin' : 'student',
                    text: msg.message,
                    time: 'هم‌اکنون',
                    status: isAdminMsg ? (msg.status === 'sent' ? 'sent' : 'failed') : 'read',
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

  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [chatSearch, setChatSearch]         = useState('');
  const [messageInput, setMessageInput]     = useState('');
  const [channelFilter, setChannelFilter]   = useState<string>('all');

  /* ── SMS Form States ── */
  const [smsRecipientStudentId, setSmsRecipientStudentId] = useState<string>('');
  const [smsCustomPhone, setSmsCustomPhone]               = useState('');
  const [selectedTemplateId, setSelectedTemplateId]       = useState('');
  const [smsBody, setSmsBody]                             = useState('');
  const [smsError, setSmsError]                           = useState('');
  const [isSendingSms, setIsSendingSms]                   = useState(false);
  const [smsSuccessToast, setSmsSuccessToast]             = useState('');

  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);


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
    const localId = Date.now();
    const threadId = activeThread.id;
    const patchMessage = (changes: Partial<ChatThread['messages'][number]>) =>
      setThreads(prev => prev.map(t => t.id !== threadId ? t : { ...t, messages: t.messages.map(m => m.id === localId ? { ...m, ...changes } : m) }));

    setThreads(prev => prev.map(t => t.id !== threadId ? t : {
      ...t,
      lastMessage: textToSend,
      time: 'هم‌اکنون',
      unreadCount: 0,
      messages: [...t.messages, { id: localId, sender: 'admin' as const, text: textToSend, time: 'هم‌اکنون', status: 'sending' as const }],
    }));
    setMessageInput('');

    try {
      const r = await api.sendMessengerMessage({
        channel: activeThread.channel,
        recipient: activeThread.phone,
        messageText: textToSend,
        student_id: activeThread.studentId,
      });
      // Reuse the server id so the polled copy of this message is recognised, not shown twice.
      if (r.success) patchMessage({ id: r.message_id ?? localId, status: 'sent' });
      else patchMessage({ id: r.message_id ?? localId, status: 'failed', error: r.message });
    } catch (e: any) {
      patchMessage({ status: 'failed', error: e?.message || 'ارسال نشد' });
    }
  };

  /** Values for the template placeholders, computed from the student's real records. */
  const studentTemplateValues = (st: Student) => {
    const enr = enrollments.filter(e => e.student_id === st.id);
    const last = enr.slice().sort((a, b) => b.id - a.id)[0];
    const courseTitle = last ? courses.find(c => c.id === last.course_id)?.title : undefined;
    const { debt } = studentBalance(enr, payments.filter(p => p.student_id === st.id));
    return { courseTitle, debt: payments.length > 0 || enr.length === 0 ? debt : undefined };
  };

  /* Fill SMS from template. Placeholders without a real value ([تاریخ]، [ساعت]…) stay in the text and must be completed before sending. */
  useEffect(() => {
    if (selectedTemplateId) {
      const tmpl = QUICK_TEMPLATES.find(t => t.id === selectedTemplateId);
      if (tmpl) {
        let text = tmpl.body;
        if (smsRecipientStudentId) {
          const st = students.find(s => s.id.toString() === smsRecipientStudentId);
          if (st) {
            const v = studentTemplateValues(st);
            text = text.replace('[نام]', st.first_name).replace('[خانوادگی]', st.last_name);
            if (v.courseTitle) text = text.replace('[دوره]', v.courseTitle);
            if (v.debt !== undefined) text = text.replace('[بدهی]', `${v.debt.toLocaleString('fa-IR')} تومان`);
            setSmsCustomPhone(st.phone_number || '');
          }
        }
        setSmsBody(text);
      }
    }
  }, [selectedTemplateId, smsRecipientStudentId, students, courses, enrollments, payments]);

  /* Send SMS Action: really sends through the server and shows the true result */
  const handleSendSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsBody.trim()) return;
    if (/\[[^\]]+\]/.test(smsBody)) {
      setSmsSuccessToast('');
      setSmsError('جای‌گذاری‌های داخل [ ] را کامل کنید، سپس ارسال کنید.');
      return;
    }

    let rName = 'شماره دستی';
    let rPhone = smsCustomPhone || '';
    let rStudentId: number | undefined;
    if (smsRecipientStudentId) {
      const st = students.find(s => s.id.toString() === smsRecipientStudentId);
      if (st) { rName = `${st.first_name} ${st.last_name}`; rPhone = st.phone_number || smsCustomPhone; rStudentId = st.id; }
    }

    setIsSendingSms(true); setSmsError('');
    let status: SmsLog['status'] = 'sent'; let error: string | undefined;
    try {
      const r = await api.sendMessengerMessage({ channel: 'sms', recipient: rPhone, messageText: smsBody.trim(), student_id: rStudentId });
      if (r.success) setSmsSuccessToast(`پیامک برای ${rPhone} ارسال شد.`);
      else { status = 'failed'; error = r.message; setSmsError(r.message); }
    } catch (err: any) {
      status = 'failed'; error = err?.message || 'ارسال ناموفق بود.'; setSmsError(error!);
    }
    setSmsLogs(prev => [{
      id: Date.now(), recipientName: rName, phoneNumber: rPhone || '—', text: smsBody,
      templateTitle: QUICK_TEMPLATES.find(t => t.id === selectedTemplateId)?.title || 'متن دلخواه',
      time: new Date().toLocaleString('fa-IR'), status, error,
    }, ...prev]);
    setIsSendingSms(false);
    if (status === 'sent') {
      setSmsBody(''); setSelectedTemplateId(''); setSmsRecipientStudentId(''); setSmsCustomPhone('');
      setTimeout(() => setSmsSuccessToast(''), 3500);
    }
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
              {filteredThreads.length === 0 && (
                <div className="p-8 text-center text-sm text-slate-400">پیامی نیست</div>
              )}
              {filteredThreads.map(thread => {
                const isSelected = activeThread?.id === thread.id;
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
                      <Avatar name={thread.senderName} className="w-10 h-10 rounded-xl border border-slate-200" />
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
            </div>
          </div>

          {/* ─── Right Pane: Active Chat Area (7 cols) ─── */}
          <div className="lg:col-span-8 flex flex-col justify-between bg-white min-h-[500px]">
            {activeThread ? (
              <>
                {/* Active Chat Header Bar */}
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar name={activeThread.senderName} className="w-9 h-9 rounded-xl border border-slate-200" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold text-slate-900">{activeThread.senderName}</h3>
                        <ChannelBadge channel={activeThread.channel} />
                      </div>
                      <p className="text-[10px] text-slate-400">{activeThread.courseTitle} — {activeThread.phone}</p>
                    </div>
                  </div>

                  {activeThread.studentId !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-md">
                        پرونده #{activeThread.studentId}
                      </span>
                    </div>
                  )}
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
                          <Avatar name={activeThread.senderName} className="w-7 h-7 rounded-lg border border-slate-200 mt-1 text-[11px]" />
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
                            msg.status === 'failed' ? (
                              <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-rose-600 font-bold">
                                <AlertCircle className="w-3 h-3" />{msg.error || 'ارسال نشد'}
                              </div>
                            ) : msg.status === 'sending' ? (
                              <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-slate-400 font-bold">
                                <Clock className="w-3 h-3" />در حال ارسال...
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-emerald-600 font-bold">
                                <CheckCheck className="w-3 h-3" />ارسال شد
                              </div>
                            )
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
          {smsError && (
            <div role="alert" className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center gap-2 shadow-xs">
              <AlertCircle className="w-4 h-4 text-rose-500" />
              {smsError}
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
                        {log.status === 'failed' ? (
                          <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full font-bold flex items-center gap-1" title={log.error}>
                            <AlertCircle className="w-3 h-3 text-rose-500" />ارسال نشد
                          </span>
                        ) : (
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-emerald-500" />ارسال شد
                          </span>
                        )}
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
