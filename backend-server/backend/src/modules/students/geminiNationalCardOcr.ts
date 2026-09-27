/**
 * Gemini 1.5 Flash Vision — Iranian national card OCR service.
 */
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  isValidNationalCode,
  normalizeJalaliDate,
  normalizeNationalCode,
  trimName,
} from '../../utils/iranNationalId.js';

export const GEMINI_NATIONAL_CARD_MODEL =
  process.env.GEMINI_OCR_MODEL || 'gemini-1.5-flash';

const SYSTEM_INSTRUCTION = `You are an OCR assistant specialized in Iranian National ID cards (کارت ملی).
Extract only what is visible on the card image. Do not invent values.
If a field is unreadable, return null for that field.
Respond with a single JSON object only — no markdown fences, no commentary.`;

const USER_PROMPT = `This image is an Iranian national identity card (کارت ملی جمهوری اسلامی ایران).
Extract these fields into JSON with exactly these keys:

{
  "first_name": string or null,
  "last_name": string or null,
  "national_code": string or null,
  "birth_date_jalali": string or null,
  "confidence": number,
  "raw_notes": string
}

Rules:
- Prefer Persian names exactly as printed.
- Convert Persian/Arabic digits to English digits in national_code and birth_date_jalali.
- birth_date_jalali must use slashes: YYYY/MM/DD when possible.
- Do not translate names to English.
- national_code should be 10 digits when readable.`;

export type NationalCardOcrResult = {
  first_name: string | null;
  last_name: string | null;
  national_code: string | null;
  birth_date_jalali: string | null;
  confidence: number;
  raw_notes: string;
  national_code_valid: boolean;
  national_code_length_ok: boolean;
  provider: string;
  model: string;
};

export type GeminiOcrInput = {
  buffer: Buffer;
  mimeType: string;
  apiKey: string;
  model?: string;
};

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/heic',
  'image/heif',
]);

export function isAllowedImageMime(mime: string | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase().split(';')[0].trim();
  return ALLOWED_MIME.has(m) || m.startsWith('image/');
}

export function guessMimeFromFilename(filename: string | undefined): string {
  const ext = path.extname(filename || '').toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };
  return map[ext] || 'image/jpeg';
}

export function extractJsonBlob(text: string): Record<string, unknown> {
  let t = (text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new Error('Model did not return valid JSON');
    }
    return JSON.parse(m[0]) as Record<string, unknown>;
  }
}

export function normalizeOcrPayload(
  parsed: Record<string, unknown>,
  model: string
): NationalCardOcrResult {
  const national_code = normalizeNationalCode(
    parsed.national_code != null ? String(parsed.national_code) : null
  );
  const confidenceRaw = Number(parsed.confidence ?? 0);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw))
    : 0;

  return {
    first_name: trimName(parsed.first_name),
    last_name: trimName(parsed.last_name),
    national_code,
    birth_date_jalali: normalizeJalaliDate(
      parsed.birth_date_jalali != null ? String(parsed.birth_date_jalali) : null
    ),
    confidence,
    raw_notes:
      parsed.raw_notes != null ? String(parsed.raw_notes).trim() : '',
    national_code_valid: isValidNationalCode(national_code),
    national_code_length_ok: national_code != null && /^\d{10}$/.test(national_code),
    provider: 'gemini-vision',
    model,
  };
}

export async function runGeminiNationalCardOcr(
  input: GeminiOcrInput
): Promise<NationalCardOcrResult> {
  const modelName = input.model || GEMINI_NATIONAL_CARD_MODEL;
  const mimeType = (input.mimeType || 'image/jpeg').toLowerCase().split(';')[0].trim();

  const genAI = new GoogleGenerativeAI(input.apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });

  const base64 = input.buffer.toString('base64');
  const result = await model.generateContent([
    { text: USER_PROMPT },
    { inlineData: { mimeType, data: base64 } },
  ]);

  const rawText = result.response.text();
  const parsed = extractJsonBlob(rawText);
  return normalizeOcrPayload(parsed, modelName);
}

export function safeUnlink(filePath: string | undefined | null): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('[ocr] failed to delete temp file:', filePath, err);
  }
}
