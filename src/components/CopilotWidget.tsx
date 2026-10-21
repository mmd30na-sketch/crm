import React, { createContext, useContext, useRef, useState } from 'react';
import { Bot, Send, Loader2, PanelRightOpen, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAuthToken } from '../api/client';

/** Assistant replies as Markdown (GFM tables); raw HTML is not rendered (no rehype-raw), links open safely. */
const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc pr-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pr-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  h1: ({ children }) => <h3 className="my-1 text-sm font-bold">{children}</h3>,
  h2: ({ children }) => <h3 className="my-1 text-sm font-bold">{children}</h3>,
  h3: ({ children }) => <h4 className="my-1 text-sm font-bold">{children}</h4>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-sky-700 underline">{children}</a>,
  code: ({ children }) => <code dir="ltr" className="rounded bg-slate-200 px-1 font-mono text-[12px]">{children}</code>,
  table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
  th: ({ children }) => <th className="border border-slate-300 bg-slate-200/60 px-2 py-1 text-right font-bold">{children}</th>,
  td: ({ children }) => <td className="border border-slate-300 px-2 py-1 text-right">{children}</td>,
};

function AssistantMarkdown({ text }: { text: string }) {
  return <div dir="rtl" className="text-right"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS} skipHtml>{text}</ReactMarkdown></div>;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PendingConfirmation {
  pending_id: string;
  preview: string;
}

interface CopilotContextValue {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  error: string | null;
  sendMessage: (raw: string) => Promise<void>;
  retry: () => void;
  openTab: () => void;
  prompts: string[];
  pendingConfirmations: PendingConfirmation[];
  clearPendingConfirmations: () => void;
}
export function quickPrompts(isAdmin: boolean): string[] {
  return [
    'ثبت‌نام‌های در انتظار سایت',
    'درآمد این ماه',
    ...(isAdmin ? ['بازدید امروز سایت'] : []),
    'کارهای امروز',
  ];
}

const SEND_FAILED = 'ارسال نشد — دوباره';

function copilotEndpoint(): string {
  const envOrigin = (import.meta as any).env?.VITE_API_ORIGIN as string | undefined;
  if (envOrigin) return `${envOrigin.replace(/\/$/, '')}/api/copilot/chat`;
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
    return 'https://crm.mmd30na.cloud/api/copilot/chat';
  }
  return '/api/copilot/chat';
}

interface CopilotContextValue {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  error: string | null;
  sendMessage: (raw: string) => Promise<void>;
  retry: () => void;
  openTab: () => void;
  prompts: string[];
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error('Copilot view rendered outside CopilotProvider');
  return ctx;
}

export function CopilotProvider({
  children,
  onOpenTab,
  isAdmin = false,
}: {
  children: React.ReactNode;
  onOpenTab: () => void;
  isAdmin?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const loadingRef = useRef(false);

  const clearPendingConfirmations = () => setPendingConfirmations([]);

  const sendMessage = async (raw: string) => {
    const content = raw.trim();
    if (!content || loadingRef.current) return;

    const current = messagesRef.current;
    const last = current[current.length - 1];
    const conversation: Message[] =
      last?.role === 'user' && last.content === content
        ? current
        : [...current, { role: 'user', content }];

    messagesRef.current = conversation;
    setMessages(conversation);
    setInput('');
    setError(null);
    setPendingConfirmations([]);
    loadingRef.current = true;
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
      if (!res.ok) {
        const serverError = typeof data?.error === 'string' ? data.error.trim() : '';
        throw new Error(serverError || SEND_FAILED);
      }
      const reply = String(data?.reply || '').trim();
      if (!reply) throw new Error(SEND_FAILED);
      if (Array.isArray(data?.pendingConfirmations) && data.pendingConfirmations.length > 0) {
        setPendingConfirmations(data.pendingConfirmations);
      }
      const next: Message[] = [...conversation, { role: 'assistant', content: reply }];
      messagesRef.current = next;
      setMessages(next);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message.trim() : '';
      const offline = !message || /failed to fetch|networkerror|load failed/i.test(message);
      setError(offline ? SEND_FAILED : message);
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  };

  const retry = () => {
    const last = [...messagesRef.current].reverse().find((m) => m.role === 'user');
    if (last) void sendMessage(last.content);
  };

  return (
    <CopilotContext.Provider
      value={{ messages, input, setInput, isLoading, error, sendMessage, retry, openTab: onOpenTab, prompts: quickPrompts(isAdmin), pendingConfirmations, clearPendingConfirmations }}
    >
      {children}
    </CopilotContext.Provider>
  );
}

function MessageList({
  messages,
  isLoading,
  limit,
  empty,
}: {
  messages: Message[];
  isLoading: boolean;
  limit?: number;
  empty: React.ReactNode;
}) {
  const shown = typeof limit === 'number' ? messages.slice(-limit) : messages;
  if (shown.length === 0 && !isLoading) return <>{empty}</>;
  return (
    <div className="space-y-3">
      {shown.map((msg, idx) => (
        <div
          key={`${msg.role}-${idx}-${msg.content.slice(0, 12)}`}
          className={`flex items-start gap-2 ${msg.role === 'user' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`}
        >
          {msg.role === 'assistant' && (
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <Bot size={14} strokeWidth={2} />
            </div>
          )}
          <div
            className={`min-w-0 rounded-2xl px-3 py-2 text-sm leading-6 ${
              msg.role === 'user'
                ? 'whitespace-pre-wrap rounded-bl-sm bg-sky-600 text-white'
                : 'rounded-br-sm bg-slate-100 text-slate-800'
            }`}
          >
            {msg.role === 'assistant' ? <AssistantMarkdown text={msg.content} /> : msg.content}
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="mr-auto flex max-w-[85%] items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
            <Bot size={14} strokeWidth={2} />
          </div>
          <div className="flex items-center gap-2 rounded-2xl rounded-br-sm bg-slate-100 px-3 py-2 text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">در حال بررسی...</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorLine({ error, onRetry, disabled }: { error: string | null; onRetry: () => void; disabled: boolean }) {
  if (!error) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-xs text-rose-700">
      <span>{error}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        className="rounded-lg px-2 py-1 font-semibold underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-40"
      >
        دوباره
      </button>
    </div>
  );
}

function PendingConfirmations({ confirmations, onConfirm, onCancel, disabled }: {
  confirmations: PendingConfirmation[];
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  disabled: boolean;
}) {
  if (!confirmations.length) return null;
  return (
    <div className="space-y-2 border-t border-slate-100 pt-2">
      {confirmations.map((c) => (
        <div key={c.pending_id} className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
          <div className="whitespace-pre-wrap text-slate-700 mb-2">{c.preview}</div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onCancel(c.pending_id)}
              disabled={disabled}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-40"
            >
              لغو
            </button>
            <button
              type="button"
              onClick={() => onConfirm(c.pending_id)}
              disabled={disabled}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-40"
            >
              تأیید و ارسال
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CopilotBar() {
  const { messages, input, setInput, isLoading, error, sendMessage, retry, openTab, prompts, pendingConfirmations, clearPendingConfirmations } = useCopilot();
  const [expanded, setExpanded] = useState(false);
  const last = messages[messages.length - 1];
  const showErrorInBar = Boolean(error) && !expanded;
  const preview = showErrorInBar
    ? error
    : isLoading
      ? 'در حال بررسی...'
      : last
        ? last.content.replace(/\s+/g, ' ')
        : '';

  const handleConfirm = async (pendingId: string) => {
    try {
      const token = getAuthToken();
      await fetch(copilotEndpoint().replace(/\/chat$/, `/pending/${pendingId}/confirm`), {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      clearPendingConfirmations();
    } catch {}
  };

  const handleCancel = async (pendingId: string) => {
    try {
      const token = getAuthToken();
      await fetch(copilotEndpoint().replace(/\/chat$/, `/pending/${pendingId}/cancel`), {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      clearPendingConfirmations();
    } catch {}
  };

  return (
    <section
      dir="rtl"
      className={`flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm ${
        expanded ? 'max-h-[40vh] sm:max-h-[320px]' : 'h-12'
      }`}
      aria-label="دستیار هوشمند"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <Bot size={16} />
          </span>
          <span className="shrink-0 text-sm font-bold text-slate-800">دستیار هوشمند</span>
          {preview && (
            <span className={`min-w-0 flex-1 truncate text-xs ${showErrorInBar ? 'text-rose-700' : 'text-slate-500'}`}>
              {preview}
            </span>
          )}
          {expanded ? <ChevronUp size={16} className="shrink-0 text-slate-400" /> : <ChevronDown size={16} className="shrink-0 text-slate-400" />}
        </button>
        {!last && !expanded && (
          <button
            type="button"
            onClick={() => void sendMessage(prompts[0])}
            disabled={isLoading}
            className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-40"
          >
            {prompts[0]}
          </button>
        )}
        <button
          type="button"
          onClick={openTab}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-sky-700 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <PanelRightOpen size={14} />
          ادامه در تب
        </button>
      </div>

      {expanded && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-slate-100 px-3 py-2">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MessageList
              messages={messages}
              isLoading={isLoading}
              limit={3}
              empty={
                <button
                  type="button"
                  onClick={() => void sendMessage(prompts[0])}
                  disabled={isLoading}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
                >
                  {prompts[0]}
                </button>
              }
            />
          </div>
          <PendingConfirmations confirmations={pendingConfirmations} onConfirm={handleConfirm} onCancel={handleCancel} disabled={isLoading} />
          <ErrorLine error={error} onRetry={retry} disabled={isLoading} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="پرسش خود را بنویسید..."
              disabled={isLoading}
              dir="rtl"
              className="h-9 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              aria-label="ارسال"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

export function CopilotPage() {
  const { messages, input, setInput, isLoading, error, sendMessage, retry, prompts, pendingConfirmations, clearPendingConfirmations } = useCopilot();
  const listRef = useRef<HTMLDivElement>(null);

  const handleConfirm = async (pendingId: string) => {
    try {
      const token = getAuthToken();
      await fetch(copilotEndpoint().replace(/\/chat$/, `/pending/${pendingId}/confirm`), {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      clearPendingConfirmations();
    } catch {}
  };

  const handleCancel = async (pendingId: string) => {
    try {
      const token = getAuthToken();
      await fetch(copilotEndpoint().replace(/\/chat$/, `/pending/${pendingId}/cancel`), {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      clearPendingConfirmations();
    } catch {}
  };

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  return (
    <section dir="rtl" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="دستیار هوشمند">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-100 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
          <Bot size={16} />
        </span>
        <div className="min-w-0 text-right">
          <h2 className="text-sm font-bold text-slate-800">دستیار هوشمند</h2>
          <p className="truncate text-[11px] text-slate-500">همان گفتگوی داشبورد، این‌جا کامل است.</p>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <MessageList
          messages={messages}
          isLoading={isLoading}
          empty={
            <div className="space-y-2">
              <p className="text-xs text-slate-500">یک سؤال را انتخاب کنید یا بنویسید.</p>
              <div className="flex flex-wrap gap-2">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    disabled={isLoading}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-40"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          }
        />
      </div>

      <PendingConfirmations confirmations={pendingConfirmations} onConfirm={handleConfirm} onCancel={handleCancel} disabled={isLoading} />

      <div className="shrink-0 space-y-2 border-t border-slate-100 p-3">
        <ErrorLine error={error} onRetry={retry} disabled={isLoading} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(input);
              }
            }}
            rows={2}
            disabled={isLoading}
            placeholder="پرسش خود را بنویسید...  Enter ارسال، Shift+Enter خط جدید"
            dir="rtl"
            className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="ارسال"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}
