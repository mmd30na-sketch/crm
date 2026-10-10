import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Download, Eye, EyeOff, ExternalLink, Loader2, Printer, RefreshCw } from 'lucide-react';
import * as api from '../../api/client';
import { Course, ReceiptSettings, Student } from '../../types';
import {
  BuildDocInput, DOC_KINDS, DOC_LABELS, DocData, DocKind, buildDocData, docWarnings, downloadFileName,
} from '../../utils/printDocs';
import { DocByKind, PAGE_MM } from './PrintDocs';
import { downloadBlob, ensureDocStyles, printDoc, printDocsSequentially, renderDocPdf, withInlinedImages } from './docService';

export interface DocsInput {
  student: Pick<Student, 'id' | 'first_name' | 'last_name' | 'national_code' | 'phone_number'> & { father_name?: string };
  enrollment: { id: number; course_number?: number | null; final_price: number };
  course?: Pick<Course, 'title' | 'tuition'> | null;
  /** Amount received for this enrollment. */
  paid: number;
  settings?: ReceiptSettings | null;
  /** Image URLs or data URLs; missing images show an empty frame plus a warning. */
  images: { personal?: string | null; nationalCard?: string | null };
  date: string;
}

export type DocPaths = Partial<Record<DocKind, string>>;
type Status = 'idle' | 'working' | 'ok' | 'failed';
interface DocState { status: Status; url?: string; error?: string }

const toBuildInput = (i: DocsInput): BuildDocInput => ({
  student: i.student, enrollment: i.enrollment, course: i.course ?? null, paid: i.paid,
  settings: i.settings ?? null, images: i.images, date: i.date,
});

/**
 * The three registration documents of one enrollment: status per document, single print/download, print all one after
 * another, retry. Used by the registration success screen (autoRun) and the student profile card.
 */
export default function RegistrationDocsPanel({
  input, existing, autoRun = false, autoPrint = false, onPathsChange, title = 'مدارک ثبت‌نام',
}: {
  input: DocsInput;
  existing?: DocPaths;
  /** Build and upload all three PDFs when the panel opens (registration). */
  autoRun?: boolean;
  /** After autoRun, print the three documents one after another. */
  autoPrint?: boolean;
  onPathsChange?: (paths: DocPaths) => void;
  title?: string;
}) {
  const [docs, setDocs] = useState<Record<DocKind, DocState>>(() => ({
    Receipt: { status: 'idle', url: existing?.Receipt },
    IDCard: { status: 'idle', url: existing?.IDCard },
    Contract: { status: 'idle', url: existing?.Contract },
  }));
  const [printing, setPrinting] = useState<DocKind | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<DocKind | null>(null);
  const blobs = useRef<Partial<Record<DocKind, Blob>>>({});
  const startedFor = useRef<string | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const patch = useCallback((kind: DocKind, next: Partial<DocState>) => {
    if (mounted.current) setDocs((d) => ({ ...d, [kind]: { ...d[kind], ...next } }));
  }, []);

  const rawData = useMemo(() => buildDocData(toBuildInput(input)), [input]);
  const warnings = useMemo(() => docWarnings(rawData), [rawData]);

  /** Document data with all images inlined (so PDFs and prints do not depend on token URLs). */
  const prepare = useCallback(async (): Promise<DocData> => {
    const { data, failed } = await withInlinedImages(buildDocData(toBuildInput(inputRef.current)));
    if (mounted.current) setImageNote(failed.length ? `بارگذاری تصویر ناموفق بود (${failed.join('، ')}) و کادر خالی چاپ می‌شود.` : null);
    return data;
  }, []);

  const generate = useCallback(async (kind: DocKind, data?: DocData): Promise<boolean> => {
    patch(kind, { status: 'working', error: undefined });
    let blob: Blob;
    try {
      const d = data ?? await prepare();
      blob = await renderDocPdf(kind, d);
      blobs.current[kind] = blob;
    } catch (err: any) {
      patch(kind, { status: 'failed', error: `ساخت PDF ناموفق بود: ${err?.message || 'خطای نامشخص'}` });
      return false;
    }
    try {
      const cur = inputRef.current;
      const res = await api.uploadEnrollmentReceipt(cur.enrollment.id, blob, { kind, filename: downloadFileName(cur.student.last_name, cur.student.id, kind) });
      patch(kind, { status: 'ok', url: res.path, error: undefined });
      onPathsChange?.({ Receipt: res.receipt_pdf_path || undefined, IDCard: res.idcard_pdf_path || undefined, Contract: res.contract_pdf_path || undefined });
      return true;
    } catch (err: any) {
      // The PDF itself exists in memory: print/download still work; only the server copy is missing.
      patch(kind, { status: 'failed', error: `PDF ساخته شد ولی ذخیره روی سرور ناموفق بود: ${err?.message || 'خطای ارتباط'}` });
      return false;
    }
  }, [patch, prepare, onPathsChange]);

  const printAll = useCallback(async (data?: DocData) => {
    setPrintNote(null);
    const d = data ?? await prepare();
    const results = await printDocsSequentially([...DOC_KINDS], () => d, (p) => {
      if (mounted.current) setPrinting(p.state === 'printing' ? p.kind : null);
    });
    if (!mounted.current) return;
    setPrinting(null);
    const failed = results.find((r) => !r.ok);
    if (failed) setPrintNote(`چاپ خودکار انجام نشد (${failed.error}). از دکمه «چاپ» هر سند استفاده کنید.`);
    else if (results.length < DOC_KINDS.length) setPrintNote('چاپ کامل نشد؛ از دکمه‌های چاپ استفاده کنید.');
  }, [prepare]);

  const runAll = useCallback(async (print: boolean) => {
    const data = await prepare();
    await Promise.allSettled(DOC_KINDS.map((k) => generate(k, data)));
    if (print) await printAll(data);
  }, [generate, prepare, printAll]);

  useEffect(() => { void ensureDocStyles(); }, []);

  useEffect(() => {
    if (!autoRun) return;
    const key = `${input.enrollment.id}`;
    if (startedFor.current === key) return;
    startedFor.current = key;
    void runAll(autoPrint);
  }, [autoRun, autoPrint, input.enrollment.id, runAll]);

  const printOne = async (kind: DocKind) => {
    setPrintNote(null);
    setPrinting(kind);
    try {
      const data = await prepare();
      // A document that was never stored (older registrations) is regenerated from the current data and uploaded in the background.
      if (!docs[kind].url && docs[kind].status !== 'working') void generate(kind, data);
      await ensureDocStyles();
      await printDoc(kind, data);
    } catch (err: any) {
      setPrintNote(`چاپ ناموفق بود: ${err?.message || 'خطای نامشخص'}`);
    } finally {
      if (mounted.current) setPrinting(null);
    }
  };

  const download = async (kind: DocKind) => {
    setPrintNote(null);
    const cur = inputRef.current;
    const name = downloadFileName(cur.student.last_name, cur.student.id, kind);
    try {
      let blob = blobs.current[kind];
      const url = docs[kind].url;
      if (!blob && url) {
        try {
          const res = await fetch(url);
          if (res.ok) blob = await res.blob();
        } catch { /* fall through to regeneration */ }
      }
      if (!blob) {
        const data = await prepare();
        blob = await renderDocPdf(kind, data);
        blobs.current[kind] = blob;
        if (!url) void generate(kind, data);
      }
      downloadBlob(blob, name);
    } catch (err: any) {
      setPrintNote(`دانلود ناموفق بود: ${err?.message || 'خطای نامشخص'}`);
    }
  };

  const busy = DOC_KINDS.some((k) => docs[k].status === 'working');
  const statusLabel = (k: DocKind) => {
    const s = docs[k];
    if (s.status === 'working') return <span className="inline-flex items-center gap-1 text-sky-700"><Loader2 className="w-3 h-3 animate-spin" />در حال ساخت و ذخیره…</span>;
    if (s.status === 'failed') return <span className="inline-flex items-start gap-1 text-rose-600"><AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />{s.error}</span>;
    if (s.status === 'ok') return <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle className="w-3 h-3" />ساخته و ذخیره شد</span>;
    if (s.url) return <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle className="w-3 h-3" />ذخیره‌شده روی سرور</span>;
    return <span className="text-amber-600">هنوز ذخیره نشده</span>;
  };

  const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

  return (
    <section className="text-right" aria-label={title} data-testid="registration-docs">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 className="text-xs font-bold text-slate-700">{title}</h3>
        <button type="button" onClick={() => void printAll()} disabled={printing !== null || busy}
          className={`${btn} bg-teal-600 hover:bg-teal-700 text-white border-teal-700`}>
          {printing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
          {printing ? `در حال چاپ ${DOC_LABELS[printing]}…` : 'چاپ هر سه (پشت‌سرهم)'}
        </button>
      </div>

      {warnings.length > 0 && (
        <ul className="mb-2 space-y-1" role="status">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}
            </li>
          ))}
        </ul>
      )}
      {imageNote && <p role="alert" className="mb-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{imageNote}</p>}
      {printNote && <p role="alert" className="mb-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{printNote}</p>}

      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
        {DOC_KINDS.map((kind) => (
          <li key={kind} className="p-2.5" data-doc-row={kind}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-800">{DOC_LABELS[kind]}</div>
                <div className="text-[11px] mt-0.5 leading-relaxed">{statusLabel(kind)}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" onClick={() => void printOne(kind)} disabled={printing !== null}
                  className={`${btn} bg-white hover:bg-slate-50 text-slate-700 border-slate-200`}><Printer className="w-3 h-3" />چاپ</button>
                <button type="button" onClick={() => void download(kind)} disabled={docs[kind].status === 'working'}
                  className={`${btn} bg-white hover:bg-slate-50 text-slate-700 border-slate-200`}><Download className="w-3 h-3" />دانلود</button>
                <button type="button" onClick={() => setPreviewKind(previewKind === kind ? null : kind)}
                  className={`${btn} bg-white hover:bg-slate-50 text-slate-700 border-slate-200`}>
                  {previewKind === kind ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}پیش‌نمایش
                </button>
                {docs[kind].url && (
                  <a href={docs[kind].url} target="_blank" rel="noopener noreferrer"
                    className={`${btn} bg-white hover:bg-slate-50 text-slate-700 border-slate-200`}><ExternalLink className="w-3 h-3" />باز کردن</a>
                )}
                <button type="button" onClick={() => void generate(kind)} disabled={docs[kind].status === 'working'}
                  className={`${btn} ${docs[kind].status === 'failed' ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'}`}>
                  <RefreshCw className="w-3 h-3" />{docs[kind].status === 'failed' ? 'تلاش دوباره' : docs[kind].url ? 'ساخت مجدد' : 'ساخت و ذخیره'}
                </button>
              </div>
            </div>
            {previewKind === kind && (
              <div className="mt-2 overflow-auto rounded-lg bg-slate-100 p-2" style={{ maxHeight: '70vh' }}>
                <div style={{ width: `calc(${PAGE_MM.width}mm * 0.8)`, height: `calc(${PAGE_MM.height}mm * 0.8)`, margin: '0 auto' }}>
                  <div style={{ transform: 'scale(0.8)', transformOrigin: 'top left', width: `${PAGE_MM.width}mm`, boxShadow: '0 1px 6px rgba(0,0,0,.2)' }} dir="ltr">
                    <DocByKind kind={kind} data={rawData} />
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
