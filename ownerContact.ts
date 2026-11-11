/**
 * «صاحب کسب‌وکار» contact (Settings → تنظیمات هم‌راز). Stored in `settings.gateways.business_owner`
 * (admin-only, never in publicSettings). Ham-Raz reads it through the `get_business_owner_contact` tool;
 * sending to the owner still uses the normal send tools and their confirm rules.
 */
export type OwnerContact = { name?: string; phone?: string; telegram?: string; rubika?: string; bale?: string };

const faToEn = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const bad = (m: string) => Object.assign(new Error(m), { status: 400 });

export function normalizeOwnerPhone(v: unknown): string {
  const s = faToEn(String(v ?? '')).replace(/[\s()-]/g, '');
  if (!s) return '';
  const m = s.replace(/^\+98/, '0').replace(/^0098/, '0').replace(/^98(?=9\d{9}$)/, '0');
  if (/^09\d{9}$/.test(m) || /^0\d{10}$/.test(m)) return m;
  throw bad('شماره تلفن باید به شکل 09xxxxxxxxx یا تلفن ثابت ۱۱ رقمی باشد.');
}
/** @id, t.me/id, https://t.me/id -> id (letters, digits, underscore; Telegram: 5-32 chars). */
export function normalizeHandle(v: unknown, kind: 'telegram' | 'rubika' | 'bale'): string {
  let s = faToEn(String(v ?? '')).trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?(t\.me|telegram\.me|rubika\.ir|ble\.ir)\//i, '').replace(/^@/, '').replace(/\/+$/, '');
  const re = kind === 'telegram' ? /^[A-Za-z][A-Za-z0-9_]{4,31}$/ : /^[A-Za-z0-9_.]{3,40}$/;
  if (!re.test(s)) throw bad(`شناسه ${kind === 'telegram' ? 'تلگرام' : kind === 'rubika' ? 'روبیکا' : 'بله'} نامعتبر است.`);
  return s;
}
export function validateOwner(b: any): OwnerContact {
  return {
    name: String(b?.name ?? '').trim().slice(0, 60),
    phone: normalizeOwnerPhone(b?.phone),
    telegram: normalizeHandle(b?.telegram, 'telegram'),
    rubika: normalizeHandle(b?.rubika, 'rubika'),
    bale: normalizeHandle(b?.bale, 'bale'),
  };
}
export function ownerLinks(o: OwnerContact) {
  return {
    phone: o.phone ? `tel:${o.phone}` : null,
    telegram: o.telegram ? `https://t.me/${o.telegram}` : null,
    rubika: o.rubika ? `https://rubika.ir/${o.rubika}` : null,
    bale: o.bale ? `https://ble.ir/${o.bale}` : null,
  };
}
