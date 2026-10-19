import React, { useEffect, useRef, useState } from 'react';
import { Bot, X, Send, Loader2 } from 'lucide-react';
import { getAuthToken } from '../api/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_PROMPTS = [
  'تراز ورودی و خروجی امروز چقدر است؟',
  'لیست ۵ بدهکار با بالاترین بدهی را بده',
  'وضعیت پرداختهای دوره جاری چطوره؟',
];

function copilotEndpoint(): string {
  const envOrigin = (import.meta as any).env?.VITE_API_ORIGIN as string | undefined;
  if (envOrigin) return `${envOrigin.replace(/\/$/, '')}/api/copilot/chat`;
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
    return 'https://crm.mmd30na.cloud/api/copilot/chat';
  }
  return '/api/copilot/chat';
}

export default function CopilotWidget() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading, isOpen]);

  const sendMessage = async (raw: string) => {
    const content = raw.trim();
    if (!content || isLoading) return;

    const nextUserMessage: Message = { role: 'user', content };
    const conversation: Message[] = [...messages, nextUserMessage];

    setMessages(conversation);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      const token = getAuthToken();
      const res = await fetch(copilotEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: conversation.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'خطا در ارتباط با دستیار هوشمند');

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: String(data?.reply || '') },
      ]);
    } catch (err: any) {
      const message = err?.message || 'خطای ناشناخته';
      setError(message);
      setMessages((prev) => [...prev, { role: 'assistant', content: `خطا: ${message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  return (
    <div dir="rtl">
      {/* ── Floating launcher ── */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        title="دستیار هوشمند مالی"
        aria-label="دستیار هوشمند مالی"
        className="fixed bottom-6 left-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-950/50 transition-all duration-200 hover:bg-indigo-500 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        <Bot size={22} strokeWidth={2} />
      </button>

      {/* ── Chat drawer ── */}
      {isOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex h-[420px] flex-col rounded-t-2xl border-t border-slate-700 bg-slate-900 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-300">
                <Bot size={18} strokeWidth={2} />
              </div>
              <div className="text-right">
                <h3 className="text-sm font-bold text-slate-100">دستیار هوشمند مالی</h3>
                <p className="text-[10px] text-slate-500">پرسش‌های حسابداری خود را بپرسید</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="بستن"
              aria-label="بستن"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs text-slate-500">پرسش‌های پیشنهادی:</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:border-indigo-500 hover:bg-indigo-600/20 hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 ${msg.role === 'user' ? 'ml-auto max-w-[80%]' : 'mr-auto max-w-[85%]'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-300">
                    <Bot size={14} strokeWidth={2} />
                  </div>
                )}
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 ${
                    msg.role === 'user'
                      ? 'rounded-br-sm bg-indigo-600 text-white'
                      : 'rounded-bl-sm bg-slate-800 text-slate-100'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="mr-auto flex max-w-[85%] items-center gap-2">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-300">
                  <Bot size={14} strokeWidth={2} />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-2 text-slate-400">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">در حال محاسبه...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-700 p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="پرسش مالی خود را بنویسید..."
              dir="rtl"
              className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              title="ارسال"
              aria-label="ارسال"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
