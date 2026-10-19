import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { DocData, DocKind, DOC_KINDS, DOC_LABELS } from '../../utils/printDocs';
import { uploadEnrollmentReceipt } from '../../api/client';
import { DocByKind, PD_CSS, PAGE_MM, fontFaceCss } from './PrintDocs';

/** Browser-side generation of the three registration documents: PDF files and the print dialog. */

const STYLE_ID = 'pd-doc-styles';
const fontStamp = () => fontFaceCss();

/** Adds the document CSS (with the self-hosted font) to the page once and waits until the font files are loaded. */
export async function ensureDocStyles(): Promise<void> {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = fontStamp() + PD_CSS;
    document.head.appendChild(style);
  }
  try {
    await Promise.all([
      document.fonts.load("400 12pt 'CarlaVazir'", 'سلام ۱۲۳ abc'),
      document.fonts.load("700 12pt 'CarlaVazir'", 'سلام ۱۲۳ abc'),
    ]);
    await document.fonts.ready;
  } catch { /* font API unavailable: the system font stack is used */ }
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** Loads an image URL into a data URL (so capture/print never depends on CORS or an expiring token). null when it cannot be loaded. */
export async function toDataUrl(src: string | null | undefined): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  try {
    const res = await fetch(src, { credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

/** Returns data with every image turned into a data URL; an image that cannot be loaded is dropped (the frame shows a placeholder). */
export async function withInlinedImages(data: DocData): Promise<{ data: DocData; failed: string[] }> {
  const [personal, nationalCard, logo] = await Promise.all([
    toDataUrl(data.images.personal), toDataUrl(data.images.nationalCard), toDataUrl(data.academy.logoUrl),
  ]);
  const failed: string[] = [];
  if (data.images.personal && !personal) failed.push('عکس پرسنلی');
  if (data.images.nationalCard && !nationalCard) failed.push('تصویر کارت ملی');
  return {
    data: { ...data, images: { personal, nationalCard }, academy: { ...data.academy, logoUrl: logo || '' } },
    failed,
  };
}

const waitImages = (root: ParentNode) => Promise.all(
  Array.from(root.querySelectorAll('img')).map((img) =>
    img.complete ? Promise.resolve() : new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); })),
);

/**
 * Renders one document to a PDF Blob: the React page is laid out by the browser (so Persian shaping, RTL and digits are
 * exactly what the user sees), captured with html2canvas and placed on A5 pages of a jsPDF document. The text is therefore
 * an image inside the PDF (not selectable); a page taller than A5 continues on the next A5 page.
 */
export async function renderDocPdf(kind: DocKind, data: DocData): Promise<Blob> {
  await ensureDocStyles();
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:148mm;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(React.createElement(DocByKind, { kind, data })));
    await waitImages(host);
    await document.fonts.ready;
    const el = host.firstElementChild as HTMLElement;
    const canvas = await html2canvas(el, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_MM.width, PAGE_MM.height], compress: true });
    pdf.setProperties({ title: `${DOC_LABELS[kind]} - ${data.student.fullName}`, subject: kind, creator: data.academy.name });
    const pageHpx = Math.round((canvas.width * PAGE_MM.height) / PAGE_MM.width);
    const pages = Math.max(1, Math.ceil((canvas.height - 2) / pageHpx));
    for (let i = 0; i < pages; i++) {
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = pageHpx;
      const ctx = slice.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, i * pageHpx, canvas.width, Math.min(pageHpx, canvas.height - i * pageHpx), 0, 0, canvas.width, Math.min(pageHpx, canvas.height - i * pageHpx));
      if (i > 0) pdf.addPage([PAGE_MM.width, PAGE_MM.height], 'portrait');
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAGE_MM.width, PAGE_MM.height, undefined, 'FAST');
    }
    const blob = pdf.output('blob');
    if (blob.size < 500) throw new Error('PDF خالی تولید شد');
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Full HTML page (with @page A5 + font) of one document, for the print iframe. */
export function docPrintHtml(kind: DocKind, data: DocData, title: string): string {
  const body = renderToStaticMarkup(React.createElement(DocByKind, { kind, data }));
  const esc = title.replace(/[<&>]/g, '');
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${esc}</title>`
    + `<style>${fontFaceCss()}${PD_CSS}html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}</body></html>`;
}

export class PrintError extends Error {}

/**
 * Prints one document through a hidden iframe. Resolves when the print dialog was closed (afterprint), or when print()
 * returned after blocking (Chrome), or after `timeoutMs`. Rejects when the browser refused to print.
 */
export async function printDoc(kind: DocKind, data: DocData, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) throw new PrintError('پنجره چاپ ساخته نشد.');
    doc.open();
    doc.write(docPrintHtml(kind, data, `${DOC_LABELS[kind]} - ${data.student.fullName}`));
    doc.close();
    await waitImages(doc);
    try { await Promise.all([doc.fonts.load("400 12pt 'CarlaVazir'", 'سلام ۱۲۳'), doc.fonts.load("700 12pt 'CarlaVazir'", 'سلام ۱۲۳')]); await doc.fonts.ready; } catch { /* ignore */ }
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const done = (err?: unknown) => { if (finished) return; finished = true; clearTimeout(timer); win.removeEventListener('afterprint', onAfter); err ? reject(err) : resolve(); };
      const onAfter = () => done();
      const timer = setTimeout(() => done(), timeoutMs);
      win.addEventListener('afterprint', onAfter);
      try {
        win.focus();
        const started = Date.now();
        win.print();
        // Chrome blocks inside print() until the dialog closes; Firefox returns at once and fires afterprint later.
        if (Date.now() - started > 400) done();
      } catch (err) {
        done(new PrintError('مرورگر اجازه چاپ نداد.'));
      }
    });
  } finally {
    iframe.remove();
  }
}

export interface PrintProgress { kind: DocKind; state: 'printing' | 'done' | 'failed'; error?: string }

/** Prints the documents one after another (each print dialog must be finished before the next opens). */
export async function printDocsSequentially(
  kinds: DocKind[], dataFor: (kind: DocKind) => DocData, onProgress?: (p: PrintProgress) => void,
): Promise<Array<{ kind: DocKind; ok: boolean; error?: string }>> {
  await ensureDocStyles();
  const out: Array<{ kind: DocKind; ok: boolean; error?: string }> = [];
  for (const kind of kinds) {
    onProgress?.({ kind, state: 'printing' });
    try {
      await printDoc(kind, dataFor(kind));
      out.push({ kind, ok: true });
      onProgress?.({ kind, state: 'done' });
    } catch (err: any) {
      const error = err?.message || 'چاپ ناموفق بود.';
      out.push({ kind, ok: false, error });
      onProgress?.({ kind, state: 'failed', error });
      break; // a refused dialog (popup/print blocked) will be refused again: leave the rest to the buttons
    }
  }
  return out;
}

/** Builds and uploads all three PDFs in parallel; one failing document never stops the others. Never throws. */
export async function uploadAllDocs(
  enrollmentId: number, data: DocData, fileNameFor: (kind: DocKind) => string,
): Promise<Array<{ kind: DocKind; ok: boolean; error?: string }>> {
  const settled = await Promise.allSettled(DOC_KINDS.map(async (kind) => {
    const blob = await renderDocPdf(kind, data);
    await uploadEnrollmentReceipt(enrollmentId, blob, { kind, filename: fileNameFor(kind) });
  }));
  return settled.map((r, i) => r.status === 'fulfilled'
    ? { kind: DOC_KINDS[i], ok: true }
    : { kind: DOC_KINDS[i], ok: false, error: (r.reason as any)?.message || 'خطای نامشخص' });
}
