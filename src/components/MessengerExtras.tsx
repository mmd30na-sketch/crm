import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, Download, FileText, Mic, Loader2, Image as ImageIcon } from 'lucide-react';
import * as api from '../api/client';

export type MsgMedia = { type: string; mime?: string; file_name?: string; size?: number };

const kindOf = (m: MsgMedia) => {
  const t = String(m.type || '').toLowerCase();
  if (t === 'image' || t === 'gif' || /^image\//.test(m.mime || '') || ['jpg', 'jpeg', 'png', 'webp'].includes(String(m.mime || '').toLowerCase())) return 'image';
  if (t === 'voice' || t === 'music' || t === 'audio') return 'audio';
  if (t === 'video') return 'video';
  return 'file';
};

/** Attachment of a Rubika account message, fetched with the auth header only when needed. */
export function MediaBlock({ id, media, onTranscribed, transcription }: { id: number; media: MsgMedia; transcription?: string; onTranscribed?: (t: string) => void }) {
  const kind = kindOf(media);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tBusy, setTBusy] = useState(false);
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  const load = async (open = false) => {
    if (src) { if (open) window.open(src, '_blank'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.fetchMessengerMedia(id); urlRef.current = r.url; setSrc(r.url);
      if (open) { const a = document.createElement('a'); a.href = r.url; a.download = media.file_name || 'file'; a.click(); }
    } catch (e: any) { setErr(e?.message || 'دریافت نشد'); } finally { setBusy(false); }
  };
  useEffect(() => { if (kind === 'image' && (media.size || 0) < 3 * 1024 * 1024) void load(); /* eslint-disable-next-line */ }, [id]);
  const transcribe = async () => {
    setTBusy(true); setErr('');
    try { const r = await api.transcribeMessengerMessage(id); onTranscribed?.(r.text); } catch (e: any) { setErr(e?.message || 'ناموفق'); } finally { setTBusy(false); }
  };
  return (
    <div className="mt-1 space-y-1.5">
      {kind === 'image' && (src
        ? <img src={src} alt={media.file_name || 'تصویر'} className="max-w-full sm:max-w-[260px] max-h-72 rounded-xl object-contain bg-white/40 cursor-pointer" onClick={() => window.open(src, '_blank')} />
        : <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/70 text-slate-700 text-[11px] font-bold">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}نمایش تصویر</button>)}
      {kind === 'audio' && (
        <div className="space-y-1.5">
          {src ? <audio controls src={src} className="w-56 max-w-full" /> :
            <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/70 text-slate-700 text-[11px] font-bold">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}پخش پیام صوتی</button>}
          {transcription
            ? <p className="text-[11px] leading-relaxed bg-white/80 text-slate-700 rounded-lg px-2.5 py-1.5"><b>متن صوت:</b> {transcription}</p>
            : <button type="button" onClick={transcribe} disabled={tBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/70 text-slate-700 text-[11px] font-bold disabled:opacity-60">{tBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}تبدیل صوت به متن</button>}
        </div>
      )}
      {(kind === 'file' || kind === 'video') && (
        <button type="button" onClick={() => load(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/70 text-slate-700 text-[11px] font-bold max-w-full">
          {busy ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Download className="w-4 h-4 shrink-0" />}
          <span className="truncate">{media.file_name || (kind === 'video' ? 'ویدیو' : 'فایل')}</span>
          {media.size ? <span className="text-slate-400 font-normal shrink-0">({Math.max(1, Math.round(media.size / 1024)).toLocaleString('fa-IR')} KB)</span> : null}
        </button>
      )}
      {err && <p className="text-[10px] font-bold text-rose-600 bg-white/80 rounded px-2 py-0.5">{err}</p>}
    </div>
  );
}

export type MenuAction = { key: string; label: string; danger?: boolean };
/** Small per-message menu (⋮). */
export function MessageMenu({ actions, onPick, align }: { actions: MenuAction[]; onPick: (k: string) => void; align: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('touchstart', h);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); };
  }, [open]);
  if (!actions.length) return null;
  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" aria-label="گزینه‌های پیام" onClick={() => setOpen(o => !o)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className={`absolute z-20 top-full mt-1 ${align === 'left' ? 'left-0' : 'right-0'} min-w-[11rem] bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-xs`}>
          {actions.map(a => (
            <button key={a.key} type="button" onClick={() => { setOpen(false); onPick(a.key); }}
              className={`w-full text-right px-3 py-2.5 hover:bg-slate-50 font-bold ${a.danger ? 'text-rose-600' : 'text-slate-700'}`}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
