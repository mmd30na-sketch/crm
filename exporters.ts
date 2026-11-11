/**
 * Server-side tabular exports without extra npm packages:
 *  - CSV: UTF-8 with BOM (Excel shows Persian correctly), CRLF, RFC 4180 quoting, and formula-injection guard
 *    (cells starting with = + - @ TAB CR are prefixed with ') for text values.
 *  - XLS: "XML Spreadsheet 2003" (SpreadsheetML). Excel and LibreOffice open it directly; it is NOT a binary
 *    BIFF8 .xls, so software that requires a real Excel 97-2003 file (e.g. Holoo's list import) needs one
 *    "Save As → Excel 97-2003" in Excel first. Sheet is right-to-left.
 */
import type express from 'express';

export type Column<T> = { header: string; value: (row: T) => unknown; type?: 'text' | 'number' };
export type ExportFormat = 'csv' | 'xls';

export const parseFormat = (v: unknown): ExportFormat | null => (v === 'csv' || v === 'xls' ? v : null);

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function guardText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const cell = (v: unknown, type?: string) => {
    if (v === null || v === undefined) return '';
    if (type !== 'text' && isNum(v)) return String(v);
    const s = guardText(String(v));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header, 'text')).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r), c.type)).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
  // XML 1.0 forbids most control characters
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export type Sheet<T> = { name: string; rows: T[]; columns: Column<T>[] };

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ]. */
export const sheetName = (s: string) => (s.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet1');

export function toSpreadsheetXml(sheets: Sheet<any>[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style><Style ss:ID="n"><NumberFormat ss:Format="#,##0"/></Style></Styles>',
  ];
  for (const sh of sheets) {
    out.push(`<Worksheet ss:Name="${xmlEsc(sheetName(sh.name))}"><Table>`);
    out.push('<Row>' + sh.columns.map((c) => `<Cell ss:StyleID="h"><Data ss:Type="String">${xmlEsc(c.header)}</Data></Cell>`).join('') + '</Row>');
    for (const r of sh.rows) {
      out.push('<Row>' + sh.columns.map((c) => {
        const v = c.value(r);
        if (v === null || v === undefined || v === '') return '<Cell/>';
        if (c.type !== 'text' && isNum(v)) return `<Cell ss:StyleID="n"><Data ss:Type="Number">${v}</Data></Cell>`;
        return `<Cell><Data ss:Type="String">${xmlEsc(String(v))}</Data></Cell>`;
      }).join('') + '</Row>');
    }
    out.push('</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions></Worksheet>');
  }
  out.push('</Workbook>');
  return out.join('\n');
}

/** ASCII-only download name (the Persian title goes in filename*). */
export function sendExport<T>(res: express.Response, format: ExportFormat, baseName: string, sheets: Sheet<T>[]): void {
  const safe = baseName.replace(/[^0-9A-Za-z_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  if (format === 'csv') {
    const first = sheets[0] || { rows: [], columns: [] };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.csv"`);
    res.send(toCsv(first.rows, first.columns));
    return;
  }
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.xls"`);
  res.send(toSpreadsheetXml(sheets));
}
