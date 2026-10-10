/** Client for the local scanner bridge (scripts/scanner-bridge.mjs). */
const BRIDGE_URL = (((import.meta as any).env?.VITE_SCANNER_BRIDGE_URL as string | undefined) || 'http://127.0.0.1:8765').replace(/\/$/, '');

export type ScannerState = 'unknown' | 'ready' | 'not-configured' | 'offline';

export async function checkScanner(): Promise<ScannerState> {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return 'offline';
    const data = await res.json();
    return data.configured ? 'ready' : 'not-configured';
  } catch {
    return 'offline';
  }
}

/** Triggers a scan on the desktop's scanner and returns the image as a File. */
export async function scanWithScanner(): Promise<File> {
  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}/scan`, { method: 'POST', signal: AbortSignal.timeout(120_000) });
  } catch {
    const err: Error & { code?: string } = new Error('برنامه اسکنر روی این کامپیوتر اجرا نیست. راهنما: scripts/SCANNER.md — یا از «انتخاب فایل» استفاده کنید.');
    err.code = 'offline';
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'اسکن ناموفق بود.');
  }
  const blob = await res.blob();
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  return new File([blob], `national-card-scan.${ext}`, { type: blob.type || 'image/jpeg' });
}
