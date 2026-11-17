export const DEFAULT_GEMINI_OCR_MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
export const DEFAULT_OCR_VISION_MODELS = ['nvidia/nemotron-3.5-super-vl-120b-a12b'];

export function parseJsonObject(text: string): any | null {
  if (typeof text !== 'string' || !text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  const end = text.lastIndexOf('}');
  if (end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function attemptTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const ms = Number(env.GEMINI_OCR_ATTEMPT_TIMEOUT_MS);
  const base = Number.isFinite(ms) && ms > 0 ? ms : 12000;
  return Math.max(3000, Math.min(25000, base));
}

export function visionModelsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = (env.OCR_VISION_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
  return raw.length ? raw : [...DEFAULT_OCR_VISION_MODELS];
}

function joinChatCompletionsUrl(base: string): string {
  const apiUrl = base.trim().replace(/\/+$/, '');
  if (apiUrl.endsWith('/chat/completions')) return apiUrl;
  if (apiUrl.endsWith('/v1')) return `${apiUrl}/chat/completions`;
  return `${apiUrl}/v1/chat/completions`;
}

export function resolveVisionEndpoint(env: NodeJS.ProcessEnv = process.env): { apiUrl: string; apiKey: string } | null {
  const dedicatedUrl = (env.OCR_VISION_API_URL || '').trim();
  const dedicatedKey = (env.OCR_VISION_API_KEY || '').trim();
  if (dedicatedUrl && dedicatedKey) return { apiUrl: joinChatCompletionsUrl(dedicatedUrl), apiKey: dedicatedKey };
  const apiUrl = (env.COPILOT_API_URL || '').trim();
  const apiKey = (env.COPILOT_API_KEY || '').trim();
  if (apiUrl && apiKey) return { apiUrl: joinChatCompletionsUrl(apiUrl), apiKey };
  return null;
}

/** Abort + reject after `ms`, even if `work` ignores the signal. */
export async function withTimeoutAbort<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('ocr attempt timeout'));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } catch (err: any) {
    if (controller.signal.aborted) throw new Error('ocr attempt timeout');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function ocrWithGeminiClients(opts: {
  clients: Array<{ models: { generateContent: (req: any) => Promise<any> } }>;
  cooldownUntil: number[];
  models: string[];
  prompt: string;
  fileBuffer: Buffer;
  mimeType: string;
  deadlineMs?: number;
  timeoutMs?: number;
  now?: () => number;
  log?: (msg: string, ...rest: any[]) => void;
}): Promise<Record<string, any> | null> {
  const now = opts.now || (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? attemptTimeoutMs();
  const deadlineMs = opts.deadlineMs ?? Infinity;

  for (let k = 0; k < opts.clients.length; k++) {
    if (now() < (opts.cooldownUntil[k] || 0)) continue;
    for (const model of opts.models) {
      if (now() > deadlineMs) return null;
      try {
        const result = await withTimeoutAbort((signal) => opts.clients[k].models.generateContent({
          model,
          contents: [
            { inlineData: { data: opts.fileBuffer.toString('base64'), mimeType: opts.mimeType } },
            { text: opts.prompt },
          ],
          config: { responseMimeType: 'application/json', temperature: 0, abortSignal: signal, httpOptions: { timeout: timeoutMs } },
        }), timeoutMs);
        const text = typeof result === 'string' ? result : (result?.text ?? '');
        const parsed = parseJsonObject(text);
        if (parsed) {
          parsed.provider = `gemini:${model}`;
          return parsed;
        }
      } catch (err: any) {
        const msg = String(err?.message || err);
        opts.log?.('Gemini OCR failed', `key#${k + 1}`, model, msg.slice(0, 160));
        if (/429|RESOURCE_EXHAUSTED|quota|API key|\b(401|403)\b/i.test(msg)) {
          opts.cooldownUntil[k] = now() + 10 * 60 * 1000;
          break;
        }
      }
    }
  }
  return null;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('');
  return '';
}

export async function ocrWithOpenAiVision(opts: {
  apiUrl: string;
  apiKey: string;
  models: string[];
  prompt: string;
  fileBuffer: Buffer;
  mimeType: string;
  deadlineMs?: number;
  timeoutMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  log?: (msg: string, ...rest: any[]) => void;
}): Promise<Record<string, any> | null> {
  const now = opts.now || (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? attemptTimeoutMs();
  const deadlineMs = opts.deadlineMs ?? Infinity;
  const fetchImpl = opts.fetchImpl || fetch;

  for (const model of opts.models) {
    if (now() > deadlineMs) return null;
    try {
      const result = await withTimeoutAbort(async (signal) => {
        const response = await fetchImpl(opts.apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: opts.prompt },
                { type: 'image_url', image_url: { url: `data:${opts.mimeType};base64,${opts.fileBuffer.toString('base64')}` } },
              ],
            }],
          }),
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      }, timeoutMs);
      const parsed = parseJsonObject(contentToText(result?.choices?.[0]?.message?.content));
      if (parsed) {
        parsed.provider = `vision:${model}`;
        return parsed;
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      opts.log?.('Vision OCR failed', model, msg.slice(0, 160));
    }
  }
  return null;
}
