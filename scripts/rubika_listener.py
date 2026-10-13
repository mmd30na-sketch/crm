#!/usr/bin/env python3
"""Main Rubika account listener (rubpy) -> CRM messenger store.

Uses the shared site session (see rubika_account.py). Pushes private-chat messages to
POST http://127.0.0.1:<port>/api/messenger/account-ingest with the shared secret from
<STATE_DIR>/ingest.secret. The CRM drops them while «اکانت اصلی روبیکا» is switched off.

  python3 rubika_listener.py            # run forever (pm2: crm-rubika-listener)
  python3 rubika_listener.py backfill [dialogs] [per_chat] [--dry-run]
"""
import asyncio, json, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rubika_account as ra

PORT = int(os.environ.get('CRM_PORT', '3001'))
INGEST_URL = f'http://127.0.0.1:{PORT}/api/messenger/account-ingest'
SECRET_FILE = os.path.join(ra.STATE_DIR, 'ingest.secret')

_names = {}


def secret():
    with open(SECRET_FILE, encoding='utf-8') as f:
        return f.read().strip()


def post(messages):
    if not messages: return {'ok': True, 'added': 0}
    body = json.dumps({'messages': messages}).encode()
    req = urllib.request.Request(INGEST_URL, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'X-Ingest-Secret': secret()})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or '{}')


async def chat_info(c, guid):
    if guid in _names: return _names[guid]
    title, phone = None, None
    try:
        u = ra.to_dict(await c.get_user_info(guid)).get('user') or {}
        title = ' '.join(x for x in [u.get('first_name'), u.get('last_name')] if x).strip() or None
        phone = u.get('phone') or None
    except Exception:
        pass
    _names[guid] = (title, phone)
    return _names[guid]


def msg_record(guid, title, phone, m, my_guid):
    text = m.get('text')
    if not text:
        t = m.get('type') or ''
        text = f'[{t}]' if t else None
    if not text: return None
    mine = m.get('is_mine')
    if mine is None: mine = m.get('author_object_guid') == my_guid
    ts = m.get('time')
    try: ts = int(ts) * 1000
    except Exception: ts = int(time.time() * 1000)
    return {'ext_id': f"{guid}:{m.get('message_id')}", 'chat_id': guid, 'title': title, 'phone': phone,
            'text': str(text)[:2000], 'time': ts, 'direction': 'out' if mine else 'in'}


async def connect():
    r = await ra.logged_in_client()
    if not r or r[1] is None:
        if r: await ra.safe_disconnect(r[0])
        return None, None
    c, me = r
    c.guid = (ra.to_dict(me).get('user') or {}).get('user_guid')
    return c, c.guid


async def backfill(n_dialogs=50, per_chat=20, dry=False):
    c, my = await connect()
    if not c: print(json.dumps({'ok': False, 'error': 'not logged in'})); return
    total_chats = total_msgs = 0
    try:
        start_id, seen = None, 0
        while seen < n_dialogs:
            r = ra.to_dict(await c.get_chats(start_id))
            chats = r.get('chats') or []
            for ch in chats:
                ab = ch.get('abs_object') or {}
                if ab.get('type') != 'User': continue
                if seen >= n_dialogs: break
                seen += 1
                guid = ch.get('object_guid')
                last = ch.get('last_message_id')
                if not guid or not last: continue
                title, phone = await chat_info(c, guid)
                title = title or ab.get('title') or ' '.join(x for x in [ab.get('first_name'), ab.get('last_name')] if x) or None
                try:
                    mr = ra.to_dict(await c.get_messages(guid, str(int(last) + 1), str(per_chat)))
                except Exception:
                    mr = {}
                msgs = mr.get('messages') or []
                recs = [x for x in (msg_record(guid, title, phone, m, my) for m in sorted(msgs, key=lambda m: int(m.get('message_id') or 0))) if x]
                total_chats += 1; total_msgs += len(recs)
                if not dry and recs: post(recs)
            if not r.get('has_continue') or not chats: break
            start_id = r.get('next_start_id') or chats[-1].get('time')
            if not start_id: break
    finally:
        await ra.safe_disconnect(c)
    print(json.dumps({'ok': True, 'chats': total_chats, 'messages': total_msgs, 'dry_run': dry}))


async def listen():
    from rubpy import Client
    c0, my = await connect()
    if not c0:
        print('not logged in; retrying in 60s', flush=True); await asyncio.sleep(60); sys.exit(1)
    await ra.safe_disconnect(c0)
    client = ra.make_client()

    @client.on_message_updates()
    async def on_msg(update):
        try:
            d = update.original_update if hasattr(update, 'original_update') else {}
            if d.get('type') != 'User' or d.get('action') not in (None, 'New'): return
            m = d.get('message') or {}
            guid = d.get('object_guid')
            if not guid or not m: return
            title, phone = await chat_info(client, guid)
            rec = msg_record(guid, title, phone, m, client.guid)
            if rec:
                await asyncio.get_running_loop().run_in_executor(None, post, [rec])
        except Exception as e:
            print('ingest error:', str(e)[:200], flush=True)

    await client.start()   # session is valid (checked above), so no interactive prompt
    print('listening as', client.guid and client.guid[:6] + '…', flush=True)
    await client.get_updates()


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == 'backfill':
        nums = [int(x) for x in a[1:] if x.isdigit()]
        asyncio.run(backfill(*(nums + [50, 20])[:2], dry='--dry-run' in a))
    else:
        asyncio.run(listen())
