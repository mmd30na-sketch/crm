import React, { ReactNode, useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import ModalPortal from './ModalPortal';

const DESKTOP_QUERY = '(min-width: 1024px)';

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window === 'undefined' || window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

/**
 * Desktop (>=1024px): renders the filters inline, unchanged.
 * Below 1024px: a compact «فیلتر» button (with active-filter count) that opens a bottom sheet.
 * Filters apply live; «اعمال» closes the sheet, «پاک کردن» calls onClear.
 */
export default function FilterSheet({ count, onClear, children, mobileExtra, title = 'فیلترها' }: {
  count: number; onClear: () => void; children: ReactNode; mobileExtra?: ReactNode; title?: string;
}) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (desktop) setOpen(false); }, [desktop]);
  if (desktop) return <>{children}</>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer shrink-0">
        <SlidersHorizontal className="w-4 h-4" />فیلتر
        {count > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-sky-600 text-white text-[10px] flex items-center justify-center">{count.toLocaleString('fa-IR')}</span>}
      </button>
      {open && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end justify-center" dir="rtl" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={title}>
            <div className="carla-filter-sheet bg-white w-full max-w-lg rounded-t-2xl shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto w-10 h-1.5 rounded-full bg-slate-200 mb-3" />
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black text-slate-800">{title}</h3>
                <button type="button" onClick={() => setOpen(false)} aria-label="بستن" className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex flex-col gap-3 [&>*]:w-full [&_select]:w-full">
                {children}
                {mobileExtra}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button type="button" onClick={() => setOpen(false)} className="py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold">اعمال</button>
                <button type="button" onClick={() => { onClear(); }} className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold">پاک کردن</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
