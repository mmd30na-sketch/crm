import React, { useEffect, useMemo, useState } from 'react';
import { Phone, StickyNote, Users, MessageSquare, Loader2 } from 'lucide-react';
import {
  listActivities, addActivity, ACTIVITY_KIND_LABEL, utc,
  type ActivityKind, type Activity, type LinkedMessage,
} from '../api/phase4';

const FORM_KINDS: ActivityKind[] = ['call', 'note', 'in_person', 'sms'];
const OUTCOME_OPTIONS = ['پاسخ داد', 'پاسخ نداد', 'مشغول بود', 'قرار پیگیری', 'ثبت‌نام می‌کند', 'منصرف شد'];

const KIND_ICON: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  call: Phone, note: StickyNote, in_person: Users, sms: MessageSquare, rubika: MessageSquare,
};

type Filter = 'all' | 'activities' | 'messages';

type MergedEntry =
  | { type: 'activity'; time: number; activity: Activity }
  | { type: 'message'; time: number; message: LinkedMessage };

function faTime(ms: number) {
  return new Date(ms).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
}

export default function ActivityTimeline({ entityType, entityId, compact }: { entityType: 'student' | 'lead'; entityId: number; compact?: boolean }) {
  const [data, setData] = useState<{ activities: Activity[]; messages: LinkedMessage[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [kind, setKind] = useState<ActivityKind>('call');
  const [outcome, setOutcome] = useState('');
  const [body, setBody] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    listActivities(entityType, entityId)
      .then(d => setData(d))
      .catch((e: any) => setLoadError(e?.message || 'خواندن فعالیت‌ها ممکن نشد.'));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [entityType, entityId]);

  const merged: MergedEntry[] = useMemo(() => {
    if (!data) return [];
    const a: MergedEntry[] = data.activities.map((activity): MergedEntry => ({
      type: 'activity', time: utc(activity.occurred_at)?.getTime() ?? 0, activity,
    }));
    const m: MergedEntry[] = data.messages.map((message): MergedEntry => ({
      type: 'message', time: new Date(message.at).getTime(), message,
    }));
    return [...a, ...m].sort((x, y) => y.time - x.time);
  }, [data]);

  const filtered = useMemo(
    () => merged.filter(e => filter === 'all' || (filter === 'activities' ? e.type === 'activity' : e.type === 'message')),
    [merged, filter],
  );

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      await addActivity({
        entity_type: entityType,
        entity_id: entityId,
        kind,
        outcome: kind === 'call' && outcome ? outcome : undefined,
        body: body.trim() || undefined,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : undefined,
      });
      setKind('call'); setOutcome(''); setBody(''); setOccurredAt('');
      load();
    } catch (err: any) {
      setSaveError(err?.message || 'ثبت فعالیت ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const pad = compact ? 'p-2' : 'p-4';
  const headerPad = compact ? 'pb-2 mb-2' : 'pb-3 mb-3';
  const itemPad = compact ? 'py-2' : 'py-3';

  return (
    <div dir="rtl" className={`bg-white border border-slate-200 rounded-xl ${pad} shadow-xs`}>
      <form onSubmit={handleSubmit} className={`border-b border-slate-100 ${headerPad} space-y-2`}>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={kind} onChange={e => setKind(e.target.value as ActivityKind)} disabled={saving}
            className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer disabled:opacity-50">
            {FORM_KINDS.map(k => <option key={k} value={k}>{ACTIVITY_KIND_LABEL[k]}</option>)}
          </select>
          {kind === 'call' && (
            <select value={outcome} onChange={e => setOutcome(e.target.value)} disabled={saving}
              className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer disabled:opacity-50">
              <option value="">نتیجه تماس...</option>
              {OUTCOME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <input type="datetime-local" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} disabled={saving}
            className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50" />
        </div>
        <textarea value={body} onChange={e => setBody(e.target.value)} disabled={saving} placeholder="شرح تماس یا یادداشت..." rows={2}
          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 resize-none" />
        {saveError && <div role="alert" className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-md">{saveError}</div>}
        <div className="flex justify-end">
          <button type="submit" disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer">
            {saving ? 'در حال ثبت...' : 'ثبت'}
          </button>
        </div>
      </form>

      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {([
          ['all', 'همه'],
          ['activities', 'تماس‌ها و یادداشت‌ها'],
          ['messages', 'پیام‌های روبیکا'],
        ] as [Filter, string][]).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer ${filter === key ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {loadError && <div role="alert" className="mb-2 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-md">{loadError}</div>}

      {data === null ? (
        <div className="text-xs text-slate-400 py-4 text-center flex items-center justify-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />در حال بارگذاری...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-slate-400 py-4 text-center">هنوز فعالیتی ثبت نشده است</div>
      ) : (
        <div className={`relative ${compact ? 'max-h-96 overflow-y-auto' : ''}`}>
          <div className="absolute right-[9px] top-1 bottom-1 w-px bg-slate-200" />
          <ul className="space-y-0">
            {filtered.map(entry => entry.type === 'activity' ? (
              <React.Fragment key={`a-${entry.activity.id}`}><ActivityRow entry={entry} itemPad={itemPad} /></React.Fragment>
            ) : (
              <React.Fragment key={`m-${entry.message.id}`}><MessageRow entry={entry} itemPad={itemPad}
                expanded={expanded.has(entry.message.id)} onToggle={() => toggleExpand(entry.message.id)} /></React.Fragment>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry, itemPad }: { entry: { type: 'activity'; time: number; activity: Activity }; itemPad: string }) {
  const { activity } = entry;
  const Icon = KIND_ICON[activity.kind];
  const title = ACTIVITY_KIND_LABEL[activity.kind] + (activity.outcome ? ` — ${activity.outcome}` : '');
  return (
    <li className={`relative pr-6 ${itemPad}`}>
      <span className="absolute right-0 top-1 w-[18px] h-[18px] rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center">
        <Icon className="w-3 h-3 text-indigo-600" />
      </span>
      <div className="text-xs font-bold text-slate-800">{title}</div>
      {activity.body && <div className="text-xs text-slate-600 whitespace-pre-wrap mt-0.5">{activity.body}</div>}
      <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5">
        {activity.staff_username && <bdi dir="ltr" className="font-mono">{activity.staff_username}</bdi>}
        <span>{faTime(entry.time)}</span>
      </div>
    </li>
  );
}

function MessageRow({ entry, itemPad, expanded, onToggle }: {
  entry: { type: 'message'; time: number; message: LinkedMessage }; itemPad: string; expanded: boolean; onToggle: () => void;
}) {
  const { message } = entry;
  const isLong = message.text.length > 180;
  const label = `پیام روبیکا ${message.direction === 'in' ? 'دریافتی' : 'ارسالی'}${message.source === 'bot' ? ' (ربات)' : ' (اکانت)'}`;
  return (
    <li className={`relative pr-6 ${itemPad}`}>
      <span className="absolute right-0 top-1 w-[18px] h-[18px] rounded-full bg-violet-50 border border-violet-200 flex items-center justify-center">
        <span className="w-2 h-2 rounded-full bg-violet-500" />
      </span>
      <div className="text-xs font-bold text-violet-700">{label}</div>
      <div className={`text-xs text-slate-600 whitespace-pre-wrap mt-0.5 ${isLong && !expanded ? 'line-clamp-4' : ''}`}>{message.text}</div>
      {isLong && (
        <button type="button" onClick={onToggle} className="text-[11px] font-bold text-violet-600 hover:underline cursor-pointer mt-0.5">
          {expanded ? 'کمتر' : 'بیشتر'}
        </button>
      )}
      <div className="text-[10px] text-slate-400 mt-1">{faTime(entry.time)}</div>
    </li>
  );
}
