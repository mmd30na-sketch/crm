"""@Kermanshahcardbot - Telegram twin of the Rubika bot @Kermanshahcartbot.
Reuses rubika-bot/bot.py (same menus, texts, lookup, AI, rate limits) with its own state.db,
plus opt-in linking (shared contact -> CRM /api/messenger/webhook -> telegram_links) for Copilot.
Long-polling (getUpdates) through TELEGRAM_PROXY. Secrets only from .env (mode 600)."""
import os, sys, sqlite3, asyncio, logging
BASE = os.path.dirname(os.path.abspath(__file__))
RUBIKA_DIR = os.environ.get("RUBIKA_BOT_DIR", "/project/kermanshahcart/rubika-bot")
sys.path.insert(0, RUBIKA_DIR)
def _load(path):  # our .env first; bot.py then fills only missing keys (DB/AI) from the Rubika .env
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
_load(os.path.join(BASE, ".env"))
import bot as B
import aiohttp
E = os.environ.get
log = logging.getLogger("tgbot")
# Own state (rate limits + admin pairing) so the Rubika admin chat is never overwritten.
B.ST = sqlite3.connect(os.path.join(BASE, "state.db"), check_same_thread=False)
B.ST.executescript("CREATE TABLE IF NOT EXISTS hits(chat TEXT, kind TEXT, ts REAL); CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);")
B.SYSTEM = B.SYSTEM.replace("ربات روبیکای", "ربات تلگرام")

TOKEN = E("TELEGRAM_BOT_TOKEN", "")
PROXY = E("TELEGRAM_PROXY") or None
API = f"https://api.telegram.org/bot{TOKEN}"
BUTTONS = {"🔎 پیگیری ثبت‌نام": "lookup", "💬 سؤال درباره دوره‌ها": "ask", "📚 آزمون‌ها و نمونه سوالات": "quizzes",
           "📞 تماس با ما": "contact", "🔙 منوی اصلی": "back"}
LINK_LABEL = "📲 اتصال به ربات (دریافت اطلاعیه‌ها)"
KP = {"main": {"keyboard": [[{"text": "🔎 پیگیری ثبت‌نام"}, {"text": "💬 سؤال درباره دوره‌ها"}],
                            [{"text": "📚 آزمون‌ها و نمونه سوالات"}, {"text": "📞 تماس با ما"}],
                            [{"text": LINK_LABEL, "request_contact": True}]], "resize_keyboard": True},
      "back": {"keyboard": [[{"text": "🔙 منوی اصلی"}]], "resize_keyboard": True}}

async def call(s, method, **body):
    async with s.post(f"{API}/{method}", json=body, proxy=PROXY) as r:
        return await r.json(content_type=None)

async def link_contact(s, msg):
    """Only the user's own contact (user_id matches sender) is accepted; CRM matches the phone to a trainee."""
    c = msg["contact"]; chat = msg["chat"]["id"]
    if msg["chat"].get("type") != "private" or c.get("user_id") != msg["from"]["id"]:
        return "❌ لطفاً فقط شماره خودتان را با دکمه «اتصال به ربات» بفرستید."
    # Only ASCII digits leave this bot: the number is forwarded to the CRM's phone lookup, so it must never
    # be able to break a query (ER_PARSE_ERROR 1064) or act as a wildcard. The CRM binds it with a
    # placeholder; keeping it a plain literal here also holds when a caller interpolates it.
    mobile = "".join(ch for ch in str(B.norm_mobile(c.get("phone_number", ""))) if ch in "0123456789")
    secret = E("MESSENGER_WEBHOOK_SECRET")
    if not mobile or not secret: return "متأسفانه اتصال الان ممکن نیست. لطفاً با آموزشگاه تماس بگیرید."
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as cs:
            async with cs.post(E("CRM_INTERNAL_URL", "http://127.0.0.1:3001").rstrip("/") + "/api/messenger/webhook",
                               headers={"x-webhook-secret": secret},
                               json={"channel": "telegram", "chat_id": str(chat), "sender_phone": mobile,
                                     "sender": "telegram", "message": "[اتصال به ربات تلگرام]"}) as r:
                ok = r.status < 300
    except Exception as e:
        log.warning("crm link error: %s", type(e).__name__); ok = False
    # Same reply whether or not a trainee matched, so the bot can't be used to probe phone numbers.
    return ("✅ درخواست اتصال ثبت شد. اگر این شماره در پرونده کارآموزی شما ثبت باشد، اطلاعیه‌های کلاس و آزمون به همین گفتگو ارسال می‌شود."
            if ok else "متأسفانه اتصال الان ممکن نیست. لطفاً بعداً دوباره تلاش کنید.")

async def on_message(s, msg):
    chat = msg["chat"]["id"]
    if "contact" in msg: txt, k = await link_contact(s, msg), "main"
    else:
        text = msg.get("text") or ""
        if msg["chat"].get("type") != "private" or not text: return
        txt, k = await B.handle(str(chat), text, BUTTONS.get(text.strip()))
    await call(s, "sendMessage", chat_id=chat, text=txt, reply_markup=KP[k], disable_web_page_preview=True)

async def main():
    if not TOKEN: sys.exit("TELEGRAM_BOT_TOKEN missing")
    offset = int(B.kv_get("tg_offset") or 0)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=70)) as s:
        info = await call(s, "getWebhookInfo")
        if info.get("result", {}).get("url"): sys.exit("webhook is set on this token; refusing to poll")
        while True:
            try:
                j = await call(s, "getUpdates", offset=offset, timeout=50, allowed_updates=["message"])
                if not j.get("ok"):
                    log.warning("getUpdates not ok: %s", j.get("error_code")); await asyncio.sleep(10); continue
                for u in j["result"]:
                    offset = u["update_id"] + 1; B.kv_set("tg_offset", str(offset))
                    if "message" in u:
                        try: await on_message(s, u["message"])
                        except Exception as e: log.exception("handler error: %s", type(e).__name__)
            except Exception as e:
                log.warning("poll error: %s", type(e).__name__); await asyncio.sleep(5)

if __name__ == "__main__":
    asyncio.run(main())
