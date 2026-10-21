/**
 * Copilot DB tools via a DBHub MCP server (read-only), mounted with the official MCP client.
 * COPILOT_DB_BACKEND=dbhub enables it (default builtin). COPILOT_DBHUB_URL / COPILOT_DBHUB_TOKEN configure it.
 * If DBHub is down, callers fall back to the builtin copilot-sql tool.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const TIMEOUT_MS = 8000;
const TOOLS_TTL_MS = 5 * 60 * 1000;
const DOWN_BACKOFF_MS = 60 * 1000;

export function dbhubSelected() {
  return String(process.env.COPILOT_DB_BACKEND || 'builtin').trim().toLowerCase() === 'dbhub';
}

let client: Client | null = null;
let tools: any[] | null = null;
let toolsAt = 0;
let downUntil = 0;

async function connect(): Promise<Client> {
  if (client) return client;
  const url = new URL(process.env.COPILOT_DBHUB_URL || 'http://127.0.0.1:18090/mcp');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('DBHub must be on localhost');
  const token = String(process.env.COPILOT_DBHUB_TOKEN || '');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  const c = new Client({ name: 'crm-copilot', version: '1.0.0' });
  await c.connect(transport, { timeout: TIMEOUT_MS });
  return (client = c);
}

async function reset() {
  const c = client; client = null; tools = null;
  try { await c?.close(); } catch { /* ignore */ }
}

/** DBHub tools in OpenAI function format, or null when DBHub is unavailable (caller falls back). */
export async function getDbhubTools(): Promise<any[] | null> {
  if (Date.now() < downUntil) return null;
  if (tools && Date.now() - toolsAt < TOOLS_TTL_MS) return tools;
  try {
    const c = await connect();
    const res = await c.listTools(undefined, { timeout: TIMEOUT_MS });
    tools = res.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: String(t.description || '').slice(0, 600), parameters: t.inputSchema || { type: 'object', properties: {} } },
    }));
    toolsAt = Date.now();
    return tools;
  } catch (e: any) {
    console.warn('DBHub unavailable, using builtin SQL:', e?.message || e);
    downUntil = Date.now() + DOWN_BACKOFF_MS;
    await reset();
    return null;
  }
}

export function isDbhubTool(name: string) {
  return Boolean(tools?.some((t) => t.function.name === name));
}

type Audit = (e: { db: string; sql: string; allowed: boolean; reason: string | null; rows: number | null; ms: number | null }) => Promise<void> | void;

export async function callDbhubTool(name: string, args: any, audit: Audit): Promise<any> {
  const t0 = Date.now();
  const sqlText = name.startsWith('execute_sql') ? String(args?.sql || '') : `${name}(${JSON.stringify(args || {})})`;
  try {
    const c = await connect();
    const res: any = await c.callTool({ name, arguments: args || {} }, undefined, { timeout: TIMEOUT_MS });
    const text = (res.content || []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    const rows = Array.isArray(parsed?.data?.rows) ? parsed.data.rows.length : (Array.isArray(parsed?.rows) ? parsed.rows.length : null);
    const failed = Boolean(res.isError) || parsed?.success === false;
    await audit({ db: 'dbhub', sql: sqlText, allowed: !failed, reason: failed ? String(parsed?.error || text).slice(0, 500) : null, rows, ms: Date.now() - t0 });
    return failed ? { error: String(parsed?.error || text).slice(0, 500) } : (parsed?.data ?? parsed);
  } catch (e: any) {
    await reset();
    await audit({ db: 'dbhub', sql: sqlText, allowed: false, reason: `dbhub error: ${String(e?.message || e).slice(0, 300)}`, rows: null, ms: Date.now() - t0 });
    return { error: 'سرویس پایگاه داده (DBHub) در دسترس نیست؛ دوباره تلاش کنید.' };
  }
}
