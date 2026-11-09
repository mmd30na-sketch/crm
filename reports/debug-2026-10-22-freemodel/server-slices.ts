      user = { id: Date.now().toString(), phone, fullName: 'ادمین آموزشگاه', purchasedExams: [] };
      await saveUser(user);
    }
    return res.json({ token: signToken(user), message: 'ورود موفق.', user: publicUser(user) });
  });

  // Student panel external links (exam card / certificate). Empty or non-http(s) values are returned as ''.
  app.get('/api/public/student-links', (_req, res) => {
    const clean = (v?: string) => { const u = String(v || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; };
    res.set('Cache-Control', 'no-store');
    return res.json({ examCardUrl: clean(process.env.EXAM_CARD_URL), certificateUrl: clean(process.env.CERTIFICATE_URL) });
  });

  // Login with national code + phone (matches a CRM registration/student record). Replaces OTP login.
  const nidIpLimiter = makeLimiter(10, 15 * 60 * 1000);
  const nidPhoneLimiter = makeLimiter(10, 15 * 60 * 1000);
  app.post('/api/auth/login-national', async (req, res) => {
    const phone = normalizePhone(req.body && req.body.phone);
    const nid = req.body && req.body.nationalId != null ? toLatinDigits(String(req.body.nationalId)).replace(/\D/g, '') : '';
    if (!phone || !isValidMobile(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    if (!/^\d{10}$/.test(nid)) return res.status(400).json({ error: 'کد ملی باید ۱۰ رقم باشد.' });
    const w1 = nidIpLimiter.hit(clientIp(req));
    const w2 = nidPhoneLimiter.hit('p:' + phone);
    if (w1 || w2) {
      res.set('Retry-After', String(w1 || w2));
      return res.status(429).json({ error: 'تلاش‌های زیاد. لطفاً ۱۵ دقیقه بعد دوباره امتحان کنید.' });
    }
    let fullName = '';
    let found = false;
    try {
      const queries = [
        "SELECT TRIM(CONCAT(IFNULL(first_name,''),' ',IFNULL(last_name,''))) AS full_name FROM students WHERE national_code = ? AND phone_number = ? LIMIT 1",
        'SELECT full_name FROM registrations WHERE national_code = ? AND phone_number = ? LIMIT 1',
      ];
      for (const sql of queries) {
        const [rows]: any = await withTimeout(mysqlPool.execute(sql, [nid, phone]), 4000);
        if (rows && rows.length) { found = true; fullName = rows[0].full_name || ''; break; }
      }
    } catch (e: any) {
      console.error('[login-national] DB error:', e && e.message);
      return res.status(503).json({ error: 'سرویس موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.' });
    }
    if (!found) {
      console.log(`[login-national] no match for phone ending ${phone.slice(-4)}`);
      return res.status(401).json({ error: 'کد ملی و شماره موبایل با هیچ پرونده‌ای مطابقت ندارد. اگر ثبت‌نام کرده‌اید با دفتر آموزشگاه تماس بگیرید.' });
    }
    let user = await findUserByPhone(phone);
    if (!user) {
      user = { id: Date.now().toString(), phone, fullName: String(fullName).trim() || 'کارآموز', purchasedExams: [] };
      await saveUser(user);
    }
    console.log(`[login-national] login ok for phone ending ${phone.slice(-4)}`);
    return res.json({ token: signToken(user), message: 'با موفقیت وارد شدید.', user: publicUser(user) });
  });

  // Fire-and-forget Telegram alert when an OTP SMS fails (same bot/proxy as registration notify).
  function notifyOtpFailure(phone: string, reason: string) {
    const text = `⚠️ ارسال کد ورود ناموفق بود\n📱 ${phone}\n❗ ${reason}\n🕒 ${new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}`;
    void notifyAdmin({ build: () => text, tag: 'OTP-failure', channels: ['telegram'] });
  }


    app.post('/api/auth/send-otp', async (req, res) => {
    const phone = normalizePhone(req.body && req.body.phone);
    if (!phone) return res.status(400).json({ error: 'شماره موبایل الزامی است.' });
    if (!isValidMobile(phone)) {
      logOtpAttempt(req, { phone: String(phone).slice(0, 20), result: 'rejected', reason: 'invalid mobile' });
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const ipWait = otpSendLimiter.hit(clientIp(req));

  app.get('/api/exams/:packageId/:sectionId', requireUser, async (req: any, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { packageId, sectionId } = req.params;
      const defs = loadPackageDefs(DATA_DIR);
      if (!Object.prototype.hasOwnProperty.call(defs, packageId)) return res.status(404).json({ error: 'بسته مورد نظر یافت نشد' });
      const ent = await entitlements.getEntitlements(req.authUser.phone);
      if (!entitlements.canAccess(ent, packageId)) {
        return res.status(403).json({ error: 'شما به این بسته دسترسی ندارید.', pendingRegistration: ent.pendingRegistration });
      }
      const qs = getSectionQuestions(DATA_DIR, defs[packageId], String(sectionId));
      if (!qs) return res.status(404).json({ error: 'این بخش یافت نشد' });
      if (!isAdminPhone(req.authUser.phone)) {
        analytics.record({ kind: 'exam', path: `${packageId}/${sectionId}`, ip: '', ua: String(req.headers['user-agent'] || ''),
          visitorOverride: crypto.createHash('sha256').update(JWT_SECRET + '|u|' + req.authUser.phone).digest('base64url').slice(0, 22) });
      }
      res.json(qs);
    } catch (e) {
      console.error('[exams/section] error:', e);
      res.status(500).json({ error: 'خطا در دریافت سوالات' });
    }
  });

  // --- PAYMENT ROUTES (ZARINPAL) ---
  const ZERO_MERCHANT = '00000000-0000-0000-0000-000000000000';
  const ZP_ENDPOINTS = {
    sandbox: {
      request: 'https://sandbox.zarinpal.com/pg/v4/payment/request.json',
      verify: 'https://sandbox.zarinpal.com/pg/v4/payment/verify.json',
      startPay: (auth: string) => `https://sandbox.zarinpal.com/pg/StartPay/${auth}`
    },
    production: {
      request: 'https://payment.zarinpal.com/pg/v4/payment/request.json',
      verify: 'https://payment.zarinpal.com/pg/v4/payment/verify.json',
      startPay: (auth: string) => `https://www.zarinpal.com/pg/StartPay/${auth}`
    }
  };
  const zarinpalConfig = () => {
    const merchantId = (process.env.ZARINPAL_MERCHANT_ID || '').trim();
    const placeholder = !merchantId || /^0+(-0+)*$/.test(merchantId);
    const sandboxFlag = process.env.ZARINPAL_SANDBOX === 'true';
    const isProd = process.env.NODE_ENV === 'production';
    // A placeholder merchant id must never silently fall back to the sandbox on the live site:
    // sandbox "payments" would grant real packages for free.
    const mode: 'sandbox' | 'production' = (sandboxFlag || (placeholder && !isProd)) ? 'sandbox' : 'production';
    const configured = mode === 'sandbox' || !placeholder;
    return { merchantId: placeholder ? ZERO_MERCHANT : merchantId, mode, configured };
  };
  const publicBase = (req: any) => {
    const env = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (env) return env;
    const host = String(req.headers.host || '');
    const origin = String(req.headers.origin || '');
    try { if (origin && new URL(origin).host === host) return origin; } catch { /* ignore */ }
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    return `${proto}://${host}`;
  };
  const payLimiter = makeLimiter(10, 10 * 60 * 1000);

  app.post('/api/payment/request', requireUser, async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    try {
      const packageId = req.body && typeof req.body.packageId === 'string' ? req.body.packageId : '';
      if (!packageId || !Object.prototype.hasOwnProperty.call(PACKAGE_PRICES, packageId)) {
        return res.status(400).json({ error: 'بسته انتخابی نامعتبر است' });
      }
      const wait = payLimiter.hit('u:' + req.authUser.id);
      if (wait) {
        res.set('Retry-After', String(wait));
        return res.status(429).json({ error: 'درخواست‌های پرداخت زیاد است. لطفاً چند دقیقه بعد تلاش کنید.' });
      }

      const zp = zarinpalConfig();
      if (!zp.configured) {
        console.error('[Zarinpal] ZARINPAL_MERCHANT_ID is not configured; payments are disabled.');
        return res.status(503).json({ error: 'درگاه پرداخت هنوز فعال نشده است. لطفاً با پشتیبانی تماس بگیرید.' });
      }

      // Do not sell a package that has no questions yet.
      const def = loadPackageDefs(DATA_DIR)[packageId];
      if (!def || countQuestions(DATA_DIR, def) === 0) {
        return res.status(409).json({ error: 'سوالات این بسته هنوز تکمیل نشده و خرید آن فعلاً امکان‌پذیر نیست.' });
      }

      // Already owns it (purchase, admin or course enrollment) -> do not charge twice.
      const dbUser = await findUserByPhone(req.authUser.phone);
      let owned = isAdminPhone(req.authUser.phone) || !!(dbUser && (dbUser.purchasedExams || []).includes(packageId));
      if (!owned) {
        try { owned = entitlements.canAccess(await entitlements.getEntitlements(req.authUser.phone), packageId); } catch { /* CRM unavailable: fall through */ }
      }
      if (owned) return res.status(409).json({ error: 'این بسته قبلاً برای حساب شما فعال است.' });

      const amountRial = PACKAGE_PRICES[packageId]; // always from the server-side price table
      const endpoints = ZP_ENDPOINTS[zp.mode];
      const callbackUrl = `${publicBase(req)}/api/payment/callback`;

      const response = await fetch(endpoints.request, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000),
        authority TEXT PRIMARY KEY,
        trackingId TEXT NOT NULL,
        phone TEXT NOT NULL,
        category TEXT,
        courseId INTEGER,
        amountToman INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        refId TEXT,
        cardPan TEXT,
        createdAt TEXT NOT NULL,
        verifiedAt TEXT,
        mysqlRecorded INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_course_payments_tracking ON course_payments(trackingId);
    `);
  } catch (e) { console.error('[course-pay] sqlite init failed:', (e as Error).message); }

  let sitePayTableReady = false;
  async function ensureSitePayTable() {
    if (sitePayTableReady) return;
    // Additive only: a new table, never ALTER of an existing one (Directus reads this DB).
    await withTimeout(mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS site_registration_payments (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tracking_code VARCHAR(32) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        course_id INT NULL,
        amount_toman BIGINT NOT NULL,
        kind VARCHAR(16) NOT NULL,
        gateway VARCHAR(32) NOT NULL DEFAULT 'zarinpal',
        authority VARCHAR(64) NOT NULL,
        ref_id VARCHAR(64) NULL,
        card_pan VARCHAR(32) NULL,
        status VARCHAR(16) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        verified_at DATETIME NULL,
        UNIQUE KEY uq_srp_authority (authority),
        KEY idx_srp_tracking (tracking_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `), 5000);
    sitePayTableReady = true;
  }

  async function coursePriceFor(courseId: number): Promise<{ priceToman: number; title: string; source: string }> {
    const fb = { priceToman: COURSE_PRICE_FALLBACK_TOMAN[courseId] || 0, title: COURSE_TITLE_FALLBACK[courseId] || '', source: 'fallback' };
    if (!mysqlOptionalOk()) return fb;
    try {
      const [rows]: any = await withTimeout(mysqlPool.execute('SELECT title, price FROM courses WHERE course_id = ? LIMIT 1', [courseId]), 2500);
      const r = rows && rows[0];
      const price = r ? Math.round(Number(r.price)) : 0;
      if (price > 0) return { priceToman: price, title: String(r.title || fb.title).trim(), source: 'crm' };
    } catch (e) { mysqlOptionalFailed(); console.error('[course-pay] price lookup failed:', (e as Error).message); }
    return fb;
  }

  const coursePaidToman = (trackingId: string): number => {
    try {
      const r: any = db.prepare("SELECT COALESCE(SUM(amountToman),0) AS s FROM course_payments WHERE trackingId = ? AND status = 'success' AND mode = 'production'").get(trackingId);
      return Number(r && r.s) || 0;
    } catch { return 0; }
  };

  // Resolves a registration by tracking code + phone and computes what is due now.
  async function coursePaymentQuote(body: any) {
    const parsed = coursePayBody.safeParse(body || {});
    if (!parsed.success) return { error: 'کد پیگیری یا شماره موبایل معتبر نیست.', status: 400 };
    const { trackingId, phone } = parsed.data;
    const reg: any = db.prepare('SELECT trackingId, fullName, phone, category, status FROM registrations WHERE trackingId = ?').get(trackingId);
    if (!reg || normalizePhone(reg.phone) !== phone) return { error: 'ثبت‌نامی با این کد پیگیری و شماره موبایل پیدا نشد.', status: 404 };
    if (reg.status === 'rejected') return { error: 'این ثبت‌نام رد شده است. با دفتر آموزشگاه تماس بگیرید.', status: 409 };
    const courseId = CATEGORY_COURSE[reg.category];
    if (!courseId) return { error: 'دوره این ثبت‌نام برای پرداخت آنلاین تعریف نشده است.', status: 409 };
    const { priceToman, title, source } = await coursePriceFor(courseId);
    if (!priceToman) return { error: 'شهریه این دوره مشخص نیست. با دفتر آموزشگاه تماس بگیرید.', status: 503 };
    const paid = coursePaidToman(trackingId);
    const remaining = Math.max(priceToman - paid, 0);
    const mode = (process.env.COURSE_PAYMENT_MODE || 'full').trim().toLowerCase() === 'deposit' ? 'deposit' : 'full';
    const deposit = Math.round(Number(process.env.COURSE_DEPOSIT_TOMAN || 0));
    // Deposit mode: first payment is the deposit; anything after it is the remaining balance.
    const kind = mode === 'deposit' && paid === 0 && deposit > 0 && deposit < priceToman ? 'deposit' : 'full';
    const dueNow = kind === 'deposit' ? deposit : remaining;
    return { trackingId, phone, reg, courseId, courseTitle: title, priceSource: source, priceToman, paidToman: paid, remainingToman: remaining, dueNowToman: dueNow, kind };
  }

  const coursePayLimiter = makeLimiter(20, 15 * 60 * 1000);

  // Public tuition list for the course pages. Same CRM rows the payment quote uses.
  app.get('/api/course-catalog', async (_req: any, res: any) => {
    res.set('Cache-Control', 'public, max-age=60');
    const ids = [1, 2, 3, 4, 5, 6];
    const byId = new Map<number, { title: string; priceToman: number }>();
    if (mysqlOptionalOk()) {
      try {
        const [rows]: any = await withTimeout(
          mysqlPool.execute('SELECT course_id, title, price FROM courses WHERE course_id IN (1,2,3,4,5,6)'),
          2500
        );
        for (const r of rows || []) {
          const priceToman = Math.round(Number(r.price));
          if (priceToman > 0) byId.set(Number(r.course_id), { title: String(r.title || '').trim(), priceToman });
        }
      } catch (e) {
        mysqlOptionalFailed();
        console.error('[course-catalog] lookup failed:', (e as Error).message);
      }
    }
    res.json({
      courses: ids.map((courseId) => {
        const live = byId.get(courseId);
        return {
          courseId,
          title: (live && live.title) || COURSE_TITLE_FALLBACK[courseId] || '',
          priceToman: (live && live.priceToman) || COURSE_PRICE_FALLBACK_TOMAN[courseId] || 0,
          source: live ? 'crm' : 'fallback',
        };
      }),
    });
  });

  app.post('/api/course-payment/quote', async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    const w = coursePayLimiter.hit(clientIp(req));
    if (w) { res.set('Retry-After', String(w)); return res.status(429).json({ error: 'تلاش‌های زیاد. لطفاً بعداً دوباره امتحان کنید.' }); }
    try {
      const q: any = await coursePaymentQuote(req.body);
      if (q.error) return res.status(q.status).json({ error: q.error });
      return res.json({
        trackingId: q.trackingId, courseTitle: q.courseTitle, priceToman: q.priceToman, paidToman: q.paidToman,
        remainingToman: q.remainingToman, dueNowToman: q.dueNowToman, kind: q.kind, fullyPaid: q.remainingToman === 0,
      });
    } catch (e) {
      console.error('[course-pay] quote error:', (e as Error).message);
      return res.status(500).json({ error: 'خطای داخلی سرور.' });
    }
  });

  app.post('/api/course-payment/request', async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    const w = coursePayLimiter.hit(clientIp(req));
    if (w) { res.set('Retry-After', String(w)); return res.status(429).json({ error: 'تلاش‌های زیاد. لطفاً بعداً دوباره امتحان کنید.' }); }
    try {
      const q: any = await coursePaymentQuote(req.body);
      if (q.error) return res.status(q.status).json({ error: q.error });
      if (q.remainingToman <= 0 || q.dueNowToman <= 0) return res.status(409).json({ error: 'شهریه این دوره قبلاً به‌طور کامل پرداخت شده است.' });
      const zp = zarinpalConfig();
      if (!zp.configured) {
        console.error('[course-pay] ZARINPAL_MERCHANT_ID is not configured; payments are disabled.');
        return res.status(503).json({ error: 'پرداخت آنلاین موقتاً در دسترس نیست.' });
      }
      const amountRial = q.dueNowToman * 10; // amount always from the server
      const sdk = zpClient(zp.mode);
      let data: any;
      try {
        data = await sdk.payments.create({
          amount: amountRial,
          callback_url: `${publicBase(req)}/api/course-payment/callback`,
          description: `شهریه دوره ${q.courseTitle} - ${q.trackingId}`.slice(0, 255),
          mobile: q.phone,
        });
      } catch (zpErr: any) {
        const body = zpErr && zpErr.response && zpErr.response.data;
        console.error('[course-pay] Zarinpal request error:', JSON.stringify(body && body.errors ? body.errors : (zpErr && zpErr.message)).slice(0, 500));
        return res.status(400).json({ error: 'خطا در ارتباط با درگاه پرداخت. لطفاً دوباره تلاش کنید.' });
      }
      if (!(data && data.data && Number(data.data.code) === 100 && data.data.authority)) {
        console.error('[course-pay] Zarinpal request rejected:', JSON.stringify(data && data.errors ? data.errors : data).slice(0, 500));
        return res.status(400).json({ error: 'خطا در ارتباط با درگاه پرداخت. لطفاً دوباره تلاش کنید.' });
      }
      const authority = String(data.data.authority);
      db.prepare(`INSERT INTO course_payments (authority, trackingId, phone, category, courseId, amountToman, kind, status, mode, createdAt)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(authority, q.trackingId, q.phone, q.reg.category, q.courseId, q.dueNowToman, q.kind, 'pending', zp.mode, new Date().toISOString());
      return res.json({ paymentUrl: sdk.payments.getRedirectUrl(authority) });
    } catch (e) {
      console.error('[course-pay] request error:', (e as Error).message);
      return res.status(500).json({ error: 'خطا در ایجاد پرداخت. لطفاً دوباره تلاش کنید.' });
    }
  });

  async function recordCoursePaymentMySQL(p: any) {
