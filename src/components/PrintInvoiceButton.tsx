import React, { useState, useCallback } from 'react';
import jsPDF from 'jspdf';
// @ts-ignore
import autoTable from 'jspdf-autotable';

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
};

export type InvoicePrintModel = {
  number: string;
  issueDate: string;
  dueDate?: string;
  currency?: string;
  status?: string;
  seller: {
    name: string;
    addressLines?: string[];
    phone?: string;
    email?: string;
    taxId?: string;
  };
  buyer: {
    name: string;
    addressLines?: string[];
    phone?: string;
    email?: string;
    taxId?: string;
  };
  lines: InvoiceLine[];
  notes?: string;
  paymentTerms?: string;
  locale?: string;
};

function lineTotals(line: InvoiceLine) {
  const net = line.quantity * line.unitPrice;
  const tax = net * (line.taxRate ?? 0);
  return { net, tax, gross: net + tax };
}

function money(amount: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

export function buildInvoicePdf(invoice: InvoicePrintModel): jsPDF {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const currency = invoice.currency ?? 'تومان';
  const locale = invoice.locale ?? 'fa-IR';
  const marginX = 14;
  let y = 16;

  // Header
  doc.setFontSize(18);
  doc.text(invoice.seller.name || 'رسید رسمی فاکتور', marginX, y);
  y += 8;

  doc.setFontSize(10);
  for (const line of invoice.seller.addressLines ?? []) {
    doc.text(line, marginX, y);
    y += 5;
  }
  if (invoice.seller.phone) {
    doc.text(`تلفن: ${invoice.seller.phone}`, marginX, y);
    y += 5;
  }

  // Invoice meta
  doc.setFontSize(14);
  doc.text('فاکتور ثبت‌نام', 196, 16, { align: 'right' });
  doc.setFontSize(10);
  doc.text(`شماره: ${invoice.number}`, 196, 24, { align: 'right' });
  doc.text(`تاریخ: ${invoice.issueDate}`, 196, 30, { align: 'right' });

  y = Math.max(y, 48) + 4;

  // Bill to
  doc.setFontSize(11);
  doc.text('مشخصات کارآموز / صورتحساب به:', marginX, y);
  y += 6;
  doc.setFontSize(10);
  doc.text(invoice.buyer.name, marginX, y);
  y += 5;
  for (const line of invoice.buyer.addressLines ?? []) {
    doc.text(line, marginX, y);
    y += 5;
  }

  y += 4;

  const rows = invoice.lines.map((line, idx) => {
    const t = lineTotals(line);
    return [
      String(idx + 1),
      line.description,
      String(line.quantity),
      money(line.unitPrice, currency, locale),
      money(t.gross, currency, locale),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['#', 'شرح خدمات / دوره', 'تعداد', 'شهریه واحد', 'مبلغ کل']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [14, 116, 144], textColor: 255 },
    margin: { left: marginX, right: marginX },
  });

  const totals = invoice.lines.reduce(
    (acc, line) => {
      const t = lineTotals(line);
      acc.gross += t.gross;
      return acc;
    },
    { gross: 0 }
  );

  const finalY: number = (doc as any).lastAutoTable?.finalY ?? y + 40;
  let ty = finalY + 10;
  const right = 196;

  doc.setFontSize(12);
  doc.text(`مبلغ قابل پرداخت: ${money(totals.gross, currency, locale)}`, right, ty, {
    align: 'right',
  });

  return doc;
}

type Props = {
  invoice: InvoicePrintModel;
  fileName?: string;
  className?: string;
  label?: string;
};

export function PrintInvoiceButton({
  invoice,
  fileName,
  className = 'px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5',
  label = 'چاپ فاکتور رسمی',
}: Props) {
  const [busy, setBusy] = useState(false);

  const onPrint = useCallback(() => {
    setBusy(true);
    try {
      const doc = buildInvoicePdf(invoice);
      const name = fileName ?? `invoice-${invoice.number}.pdf`;
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank', 'noopener,noreferrer');
      if (w) {
        setTimeout(() => {
          try {
            w.focus();
            w.print();
          } catch {}
        }, 400);
      } else {
        doc.save(name);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setBusy(false);
    }
  }, [invoice, fileName]);

  const onDownload = useCallback(() => {
    const doc = buildInvoicePdf(invoice);
    doc.save(fileName ?? `invoice-${invoice.number}.pdf`);
  }, [invoice, fileName]);

  return (
    <div className="inline-flex items-center gap-2">
      <button type="button" onClick={onPrint} disabled={busy} className={className}>
        {busy ? 'در حال آماده‌سازی...' : label}
      </button>
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-all"
      >
        دانلود PDF
      </button>
    </div>
  );
}

export default PrintInvoiceButton;
