#!/usr/bin/env python3
"""CRM helper for the main Rubika account (rubpy self-bot).

Shares the site's session: <dir>/office_session.rp + <dir>/office_user_token.json.
Usage: python3 rubika_account.py <status|send_code|sign_in|logout>  (JSON args on stdin)
Prints one JSON line. Never prints auth, private keys, codes or phone_code_hash.
"""
import asyncio, json, os, sys, time, shutil

SESSION_DIR = os.environ.get('RUBIKA_SESSION_DIR', '/project/kermanshahcart/site')
STATE_DIR = os.environ.get('RUBIKA_STATE_DIR', '/project/kermanshahcart/crm-data/rubika')
ARCHIVE_DIR = os.environ.get('RUBIKA_ARCHIVE_DIR', '/project/_archive')
SESSION_NAME = os.path.join(SESSION_DIR, 'office_session')
SESSION_FILE = SESSION_NAME + '.rp'
TOKEN_FILE = os.path.join(SESSION_DIR, 'office_user_token.json')
PENDING_FILE = os.path.join(STATE_DIR, 'pending_login.json')
PENDING_TTL = 600

os.umask(0o077)


def out(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def mask_phone(p):
    p = str(p or '')
    return (p[:4] + '***' + p[-3:]) if len(p) > 7 else p


def normalize_phone(p):
    p = str(p or '').translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹', '0123456789'))
    p = ''.join(ch for ch in p if ch.isdigit())
    if p.startswith('00'): p = p[2:]
    if p.startswith('0'): p = '98' + p[1:]
    if p.startswith('9') and len(p) == 10: p = '98' + p
    return p if 10 <= len(p) <= 15 else None


def write_private(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def to_dict(obj):
    for attr in ('original_update',):
        v = getattr(obj, attr, None)
        if isinstance(v, dict): return v
    if isinstance(obj, dict): return obj
    try: return json.loads(str(obj))
    except Exception: return {}


def make_client(with_session=True, tmp_auth=None):
    from rubpy import Client
    if with_session:
        tok = read_json(TOKEN_FILE) or {}
        return Client(name=SESSION_NAME, auth=tok.get('auth'), private_key=tok.get('private_key'))
    # temp client for the login flow, does not touch the shared session file
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    tmp = os.path.join(STATE_DIR, 'login_tmp.rp')
    if os.path.exists(tmp): os.remove(tmp)
    return Client(name=os.path.join(STATE_DIR, 'login_tmp'), auth=tmp_auth)


async def logged_in_client():
    from rubpy.crypto import Crypto
    from Crypto.PublicKey import RSA
    from Crypto.Signature import pkcs1_15
    if not os.path.exists(SESSION_FILE) and not os.path.exists(TOKEN_FILE):
        return None
    c = make_client()
    await c.connect()
    if not c.auth or not c.private_key:
        return c, None
    c.decode_auth = Crypto.decode_auth(c.auth)
    c.import_key = pkcs1_15.new(RSA.import_key(c.private_key.encode()))
    try:
        me = await c.get_me()
    except Exception as e:
        await safe_disconnect(c)
        raise e
    return c, me


async def cmd_status(_):
    pending = read_json(PENDING_FILE)
    pending_info = None
    if pending and time.time() - pending.get('ts', 0) < PENDING_TTL:
        pending_info = {'phone': mask_phone(pending.get('phone')), 'step': pending.get('step')}
    try:
        r = await logged_in_client()
    except Exception as e:
        return {'ok': True, 'logged_in': False, 'pending': pending_info, 'error': str(e)[:200]}
    if not r or r[1] is None:
        if r: await safe_disconnect(r[0])
        return {'ok': True, 'logged_in': False, 'pending': pending_info}
    c, me = r
    u = to_dict(me).get('user', {}) or {}
    await safe_disconnect(c)
    name = ' '.join(x for x in [u.get('first_name'), u.get('last_name')] if x).strip()
    return {'ok': True, 'logged_in': True, 'name': name or None, 'username': u.get('username') or None,
            'phone': mask_phone(u.get('phone')), 'pending': pending_info}


async def safe_disconnect(c):
    try: await c.disconnect()
    except Exception: pass


async def cmd_send_code(args):
    phone = normalize_phone(args.get('phone'))
    if not phone:
        return {'ok': False, 'error': 'شماره تلفن نامعتبر است.'}
    pass_key = (args.get('pass_key') or '').strip() or None
    prev = read_json(PENDING_FILE) or {}
    reuse = prev.get('tmp') if pass_key and prev.get('phone') == phone else None
    c = make_client(with_session=False, tmp_auth=reuse)
    await c.connect()
    try:
        res = await c.send_code(phone_number=phone, pass_key=pass_key, send_type='SMS')
    finally:
        await safe_disconnect(c)
    d = to_dict(res)
    status = d.get('status') or getattr(res, 'status', None)
    if status == 'SendPassKey':
        write_private(PENDING_FILE, {'phone': phone, 'step': 'password', 'ts': time.time(), 'tmp': c.auth})
        return {'ok': True, 'step': 'password', 'hint': d.get('hint_pass_key') or None}
    if status == 'OK':
        h = d.get('phone_code_hash') or getattr(res, 'phone_code_hash', None)
        if not h:
            return {'ok': False, 'error': 'پاسخ روبیکا phone_code_hash نداشت.'}
        write_private(PENDING_FILE, {'phone': phone, 'hash': h, 'step': 'code', 'ts': time.time(), 'tmp': c.auth})
        return {'ok': True, 'step': 'code'}
    return {'ok': False, 'error': f'ارسال کد ناموفق ({status or "نامشخص"})'}


async def cmd_sign_in(args):
    from rubpy.crypto import Crypto
    code = ''.join(ch for ch in str(args.get('code') or '').translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹', '0123456789')) if ch.isdigit())
    p = read_json(PENDING_FILE)
    if not p or p.get('step') != 'code' or time.time() - p.get('ts', 0) > PENDING_TTL:
        return {'ok': False, 'error': 'ابتدا «ارسال کد» را بزنید (یا کد منقضی شده است).'}
    if not code:
        return {'ok': False, 'error': 'کد را وارد کنید.'}
    from Crypto.PublicKey import RSA
    from Crypto.Signature import pkcs1_15
    public_key, private_key = Crypto.create_keys()
    c = make_client(with_session=False, tmp_auth=p.get('tmp'))
    await c.connect()
    done = False
    try:
        res = await c.sign_in(phone_code=code, phone_number=p['phone'], phone_code_hash=p['hash'], public_key=public_key)
        d = to_dict(res)
        status = d.get('status') or getattr(res, 'status', None)
        if status != 'OK':
            return {'ok': False, 'error': f'کد تأیید نشد ({status or "نامشخص"})'}
        done = True
        auth = Crypto.decrypt_RSA_OAEP(private_key, d.get('auth') or res.auth)
        user = d.get('user') or {}
        # Same as rubpy start(): switch this client to the new auth, then registerDevice.
        # Without registerDevice Rubika answers NOT_REGISTERED for the new session.
        c.auth = auth
        c.key = Crypto.passphrase(auth)
        c.decode_auth = Crypto.decode_auth(auth)
        c.private_key = private_key
        c.import_key = pkcs1_15.new(RSA.import_key(private_key.encode()))
        reg_err = None
        try:
            await c.register_device(device_model='Ham-Taraz CRM')
        except Exception as e:
            reg_err = str(e)[:200]
        backup_existing()
        from rubpy.sessions import SQLiteSession
        if os.path.exists(SESSION_FILE): os.remove(SESSION_FILE)
        s = SQLiteSession(SESSION_NAME)
        s.insert(phone_number=user.get('phone') or p['phone'], auth=auth, guid=user.get('user_guid'),
                 user_agent=c.user_agent, private_key=private_key)
        try: s._connection.close()
        except Exception: pass
        os.chmod(SESSION_FILE, 0o600)
        write_private(TOKEN_FILE, {'phone_number': user.get('phone') or p['phone'], 'auth': auth,
                                   'private_key': private_key, 'public_key': public_key})
    finally:
        await safe_disconnect(c)
        for f in ((PENDING_FILE,) if done else ()) + (os.path.join(STATE_DIR, 'login_tmp.rp'),):
            try: os.remove(f)
            except FileNotFoundError: pass
    if reg_err:
        return {'ok': False, 'error': f'ورود انجام شد ولی ثبت دستگاه ناموفق بود: {reg_err}'}
    return {'ok': True}


def backup_existing():
    ts = time.strftime('%Y%m%d-%H%M%S')
    dest = os.path.join(ARCHIVE_DIR, f'rubika-session-{ts}')
    copied = False
    for f in (SESSION_FILE, TOKEN_FILE):
        if os.path.exists(f):
            os.makedirs(dest, mode=0o700, exist_ok=True)
            shutil.copy2(f, dest); os.chmod(os.path.join(dest, os.path.basename(f)), 0o600)
            copied = True
    return dest if copied else None


async def cmd_logout(_):
    terminated = False
    note = None
    try:
        r = await logged_in_client()
        if r and r[1] is not None:
            c = r[0]
            try:
                sess = to_dict(await c.get_my_sessions())
                items = sess.get('user_sessions') or sess.get('sessions') or []
                cur = None
                for it in items:
                    if it.get('is_current') or it.get('current') or it.get('is_this_session'):
                        cur = it; break
                key = cur and (cur.get('key') or cur.get('session_key'))
                if key:
                    await c.terminate_session(session_key=key); terminated = True
                else:
                    note = 'نشست جاری در لیست روبیکا شناسایی نشد؛ فقط نشست محلی حذف شد.'
            finally:
                await safe_disconnect(c)
    except Exception as e:
        note = f'خطا در بستن نشست روی روبیکا: {str(e)[:150]}'
    backup_existing()
    for f in (SESSION_FILE, TOKEN_FILE, PENDING_FILE):
        try: os.remove(f)
        except FileNotFoundError: pass
    return {'ok': True, 'terminated_remote': terminated, 'note': note}


async def cmd_send(args):
    guid = str(args.get('guid') or '').strip()
    text = str(args.get('text') or '')
    if not guid or not text.strip():
        return {'ok': False, 'error': 'گیرنده یا متن خالی است.'}
    r = await logged_in_client()
    if not r or r[1] is None:
        if r: await safe_disconnect(r[0])
        return {'ok': False, 'error': 'اکانت اصلی روبیکا وارد نشده است.'}
    c = r[0]
    try:
        res = to_dict(await c.send_message(guid, text[:4000]))
        mid = (res.get('message_update') or {}).get('message_id') or (res.get('message_update') or {}).get('message', {}).get('message_id')
        return {'ok': True, 'message_id': str(mid) if mid else None}
    finally:
        await safe_disconnect(c)


def _mid(v):
    v = str(v or '').strip()
    return v if v.isdigit() else None


async def _with_client(fn):
    r = await logged_in_client()
    if not r or r[1] is None:
        if r: await safe_disconnect(r[0])
        return {'ok': False, 'error': 'اکانت اصلی روبیکا وارد نشده است.'}
    c = r[0]
    try:
        return await fn(c)
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}
    finally:
        await safe_disconnect(c)


async def cmd_delete(args):
    guid = str(args.get('guid') or '').strip(); ids = [m for m in (_mid(x) for x in (args.get('message_ids') or [])) if m]
    typ = 'Local' if args.get('type') == 'Local' else 'Global'
    if not guid or not ids: return {'ok': False, 'error': 'شناسه پیام نامعتبر است.'}
    async def run(c):
        d = to_dict(await c.delete_messages(guid, ids, typ))
        st = d.get('status') or (d.get('message_updates') and 'OK')
        return {'ok': True, 'type': typ, 'raw_status': str(st)[:40] if st else None}
    return await _with_client(run)


async def cmd_edit(args):
    guid = str(args.get('guid') or '').strip(); mid = _mid(args.get('message_id')); text = str(args.get('text') or '')
    if not guid or not mid or not text.strip(): return {'ok': False, 'error': 'ورودی نامعتبر است.'}
    async def run(c):
        await c.edit_message(guid, mid, text[:4000])
        return {'ok': True}
    return await _with_client(run)


async def cmd_send_file(args):
    import pathlib
    guid = str(args.get('guid') or '').strip(); path = str(args.get('path') or ''); kind = args.get('kind')
    caption = (str(args.get('caption') or '').strip() or None)
    if not guid or not os.path.isfile(path): return {'ok': False, 'error': 'فایل یا گیرنده نامعتبر است.'}
    async def run(c):
        p = pathlib.Path(path)
        if kind == 'photo': res = await c.send_photo(guid, p, caption=caption)
        else: res = await c.send_document(guid, p, caption=caption)
        d = to_dict(res)
        mu = d.get('message_update') or {}
        mid = mu.get('message_id') or (mu.get('message') or {}).get('message_id')
        return {'ok': True, 'message_id': str(mid) if mid else None}
    return await _with_client(run)


async def cmd_seen(args):
    guid = str(args.get('guid') or '').strip(); mid = _mid(args.get('message_id'))
    if not guid or not mid: return {'ok': False, 'error': 'ورودی نامعتبر است.'}
    async def run(c):
        await c.seen_chats({guid: mid})
        return {'ok': True}
    return await _with_client(run)


async def cmd_transcribe(args):
    guid = str(args.get('guid') or '').strip(); mid = _mid(args.get('message_id'))
    if not guid or not mid: return {'ok': False, 'error': 'ورودی نامعتبر است.'}
    async def run(c):
        d = to_dict(await c.transcribe_voice(guid, mid))
        text = d.get('text'); tid = d.get('transcription_id'); st = d.get('status')
        for _ in range(8):
            if text or not tid: break
            await asyncio.sleep(2)
            g = to_dict(await c.get_transcription(mid, tid))
            text = g.get('text'); st = g.get('status') or st
        if text: return {'ok': True, 'text': str(text)[:4000]}
        return {'ok': False, 'error': f'متن صوت آماده نشد ({st or "نامشخص"}).'}
    return await _with_client(run)


async def cmd_download(args):
    guid = str(args.get('guid') or '').strip(); mid = _mid(args.get('message_id')); dest = str(args.get('dest') or '')
    max_bytes = int(args.get('max_bytes') or 25 * 1024 * 1024)
    if not guid or not mid or not dest: return {'ok': False, 'error': 'ورودی نامعتبر است.'}
    async def run(c):
        d = to_dict(await c.get_messages_by_id(guid, [mid]))
        msgs = d.get('messages') or []
        if not msgs: return {'ok': False, 'error': 'پیام پیدا نشد.'}
        fi = msgs[0].get('file_inline')
        if not fi: return {'ok': False, 'error': 'این پیام فایل ندارد.'}
        if int(fi.get('size') or 0) > max_bytes: return {'ok': False, 'error': 'فایل بزرگ‌تر از حد مجاز است.'}
        data = await c.download(fi)
        os.makedirs(os.path.dirname(dest), mode=0o700, exist_ok=True)
        tmp = dest + '.tmp'
        with open(tmp, 'wb') as f: f.write(data)
        os.replace(tmp, dest)
        return {'ok': True, 'mime': fi.get('mime'), 'file_name': fi.get('file_name'), 'type': fi.get('type'), 'size': len(data)}
    return await _with_client(run)


def _rubika_phone(v):
    d = ''.join(ch for ch in str(v or '') if ch.isdigit())
    if d.startswith('0098'): d = d[4:]
    elif d.startswith('98'): d = d[2:]
    elif d.startswith('0'): d = d[1:]
    return '98' + d if len(d) == 10 and d.startswith('9') else None


FLOOD_MARKS = ('TOO_REQUEST', 'FLOOD', 'TOO_MANY', 'RATE_LIMIT')


async def _add_one(c, phone, first, last):
    """addAddressBook only (no message is ever sent). Returns status added / not_on_rubika with the user guid if any."""
    d = to_dict(await c.add_address_book(phone, (first or '').strip()[:60] or 'هنرجو', (last or '').strip()[:60]))
    user = d.get('user') or {}
    guid = user.get('user_guid') or (d.get('chat') or {}).get('object_guid')
    if d.get('user_exist') is False or not guid:
        return {'status': 'not_on_rubika'}
    return {'status': 'added', 'guid': str(guid)}


async def cmd_add_contact(args):
    phone = _rubika_phone(args.get('phone'))
    if not phone: return {'ok': False, 'error': 'شماره موبایل معتبر نیست.'}
    async def run(c):
        r = await _add_one(c, phone, args.get('first_name'), args.get('last_name'))
        return {'ok': True, **r}
    return await _with_client(run)


async def cmd_delete_contact(args):
    guid = str(args.get('guid') or '').strip()
    if not guid or not guid.replace('_', '').isalnum(): return {'ok': False, 'error': 'شناسه کاربر نامعتبر است.'}
    async def run(c):
        await c.delete_contact(guid)
        return {'ok': True}
    return await _with_client(run)


async def cmd_add_contacts(args):
    """Bulk add with one client: one line of JSON per item on stdout, random 3-5 s gap, stops on flood or 3 errors in a row."""
    import random
    items = (args.get('items') or [])[:2000]
    lo = max(3.0, float(args.get('min_delay') or 3)); hi = max(lo, float(args.get('max_delay') or 5))
    r = await logged_in_client()
    if not r or r[1] is None:
        if r: await safe_disconnect(r[0])
        return {'type': 'done', 'ok': False, 'stopped': 'not_logged_in', 'error': 'اکانت اصلی روبیکا وارد نشده است.'}
    c = r[0]; errors_in_row = 0; stopped = None
    try:
        for i, it in enumerate(items):
            if i: await asyncio.sleep(random.uniform(lo, hi))
            key = str(it.get('key') or '')
            phone = _rubika_phone(it.get('phone'))
            if not phone:
                out({'type': 'item', 'key': key, 'status': 'failed', 'error': 'شماره نامعتبر'}); continue
            try:
                res = await _add_one(c, phone, it.get('first_name'), it.get('last_name'))
                errors_in_row = 0
                out({'type': 'item', 'key': key, **res})
            except Exception as e:
                msg = str(e)[:200]
                out({'type': 'item', 'key': key, 'status': 'failed', 'error': msg})
                if any(m in msg.upper() for m in FLOOD_MARKS): stopped = 'flood'; break
                errors_in_row += 1
                if errors_in_row >= 3: stopped = 'errors'; break
    finally:
        await safe_disconnect(c)
    return {'type': 'done', 'ok': True, 'stopped': stopped}


CMDS = {'send': cmd_send, 'status': cmd_status, 'send_code': cmd_send_code, 'sign_in': cmd_sign_in, 'logout': cmd_logout,
        'delete': cmd_delete, 'edit': cmd_edit, 'send_file': cmd_send_file, 'seen': cmd_seen, 'transcribe': cmd_transcribe,
        'download': cmd_download, 'add_contact': cmd_add_contact, 'delete_contact': cmd_delete_contact,
        'add_contacts': cmd_add_contacts}


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd not in CMDS:
        out({'ok': False, 'error': 'unknown command'}); sys.exit(2)
    try:
        args = json.loads(sys.stdin.read() or '{}')
    except Exception:
        args = {}
    try:
        out(asyncio.run(CMDS[cmd](args)))
    except Exception as e:
        out({'ok': False, 'error': str(e)[:300]})
