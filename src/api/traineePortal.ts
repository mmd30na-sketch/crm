// Trainee portal (PWA) API client. Session = signed trainee token (same token the /api/trainee-payments/* routes accept),
// kept in localStorage; GET responses are cached in localStorage so the installed app can show the last data offline.
type Session = {
  token: string;
  student_id: string;
  name: string;
  at: number;
};

type OtpRequestResponse = {
  ok: boolean;
  sent: boolean;
  expires_in: number;
  dev_code?: string;
};

type OtpVerifyResponse = {
  accounts: Array<{
    student_id: string;
    name: string;
    token: string;
  }>;
};

type LegacyLoginResponse = {
  token: string;
  student: {
    id: string;
    first_name: string;
    last_name: string;
  };
};

type Lesson = {
  id: string;
  lesson_date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'done' | 'no_show';
  instructor_name: string;
  vehicle_name: string | null;
};

type LessonsResponse = {
  upcoming: Lesson[];
  past: Lesson[];
};

type Installment = {
  id: string;
  enrollment_id: string;
  seq: number;
  amount: number;
  due_date_jalali: string;
  status: 'unpaid' | 'paid';
  overdue: boolean;
};

type InstallmentsResponse = {
  installments: Installment[];
};

type StatusResponse = {
  student: {
    id: string;
    first_name: string;
    last_name: string;
    status: string;
  };
  enrollments: Array<{
    id: string;
    course_title: string;
    course_number: string;
    signup_date_jalali: string;
    final_price: number;
    paid: number;
    remaining: number;
    term_status: 'active' | 'finished' | 'planned';
    term_start: string;
    term_end: string;
  }>;
};

type PayOnlineResponse = {
  payment_url: string;
};

const API_BASE = '/api/trainee-portal';
const PAYMENTS_BASE = '/api/trainee-payments';
const SESSION_KEY = 'carla_trainee_portal';
const CACHE_PREFIX = 'carla_tp_cache:';
const RETURN_KEY = 'carla_tp_return';
let lastFromCache = false;
/** True when the most recent GET was served from the offline cache. */
export const servedFromCache = () => lastFromCache;
/** Persian/Arabic digits -> Latin. */
export const toLatin = (v: string) => String(v || '').replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
/** Marks that the next ?trainee=1&payment= return from the gateway belongs to the portal (see App.tsx). */
export const markPortalPaymentReturn = () => { try { localStorage.setItem(RETURN_KEY, String(Date.now())); } catch { /* ignore */ } };
export const consumePortalPaymentReturn = (): boolean => {
  try {
    const at = Number(localStorage.getItem(RETURN_KEY) || 0);
    localStorage.removeItem(RETURN_KEY);
    return at > 0 && Date.now() - at < 2 * 3600 * 1000;
  } catch { return false; }
};

function getSession(): Session | null {
  const data = localStorage.getItem(SESSION_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  // Cached personal data must not outlive the session on a shared phone.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
  }
}

async function cachedGet<T>(token: string, path: string): Promise<{ data: T; offline: boolean }> {
  const cacheKey = CACHE_PREFIX + path;
  const cachedData = localStorage.getItem(cacheKey);
  let response: Response;
  try {
    response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch (error) {
    // Network failure only (offline): fall back to the last cached copy.
    if (cachedData) {
      lastFromCache = true;
      return { data: JSON.parse(cachedData), offline: true };
    }
    throw new Error('اتصال به اینترنت برقرار نیست.');
  }
  if (!response.ok) {
    if (response.status === 401) {
      const error = new Error('نشست منقضی شده است؛ دوباره وارد شوید.');
      (error as any).status = 401;
      throw error;
    }
    const body = await response.json().catch(() => ({}));
    throw new Error((body as any).error || 'خطا در دریافت اطلاعات');
  }
  const data = await response.json();
  try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* quota */ }
  lastFromCache = false;
  return { data, offline: false };
}

async function requestOtp(mobile: string): Promise<OtpRequestResponse> {
  const response = await fetch(`${API_BASE}/otp/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mobile: toLatin(mobile) }),
  });

  if (!response.ok) {
    const body: any = await response.json().catch(() => ({}));
    throw new Error(body.error || 'خطا در درخواست کد تأیید');
  }

  return response.json();
}

async function verifyOtp(mobile: string, code: string): Promise<OtpVerifyResponse> {
  const response = await fetch(`${API_BASE}/otp/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mobile: toLatin(mobile), code: toLatin(code) }),
  });

  if (!response.ok) {
    const body: any = await response.json().catch(() => ({}));
    throw new Error(body.error || 'کد تأیید نامعتبر است');
  }

  return response.json();
}

async function legacyLogin(student_id: string, national_last4: string): Promise<LegacyLoginResponse> {
  const response = await fetch(`${PAYMENTS_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ student_id: Number(toLatin(student_id)), national_last4: toLatin(national_last4) }),
  });

  if (!response.ok) {
    const body: any = await response.json().catch(() => ({}));
    throw new Error(body.error || 'ورود ناموفق بود');
  }

  return response.json();
}

async function fetchLessons(token: string): Promise<LessonsResponse> {
  const { data } = await cachedGet<LessonsResponse>(token, `${API_BASE}/lessons`);
  return data;
}

async function fetchInstallments(token: string): Promise<InstallmentsResponse> {
  const { data } = await cachedGet<InstallmentsResponse>(token, `${API_BASE}/installments`);
  return data;
}

async function fetchStatus(token: string): Promise<StatusResponse> {
  const { data } = await cachedGet<StatusResponse>(token, `${API_BASE}/status`);
  return data;
}

async function payOnline(token: string, enrollment_id: string, amount: number): Promise<PayOnlineResponse> {
  const response = await fetch(`${PAYMENTS_BASE}/zarinpal/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ enrollment_id: Number(enrollment_id), amount }),
  });

  if (!response.ok) {
    const body: any = await response.json().catch(() => ({}));
    throw new Error(body.error || 'خطا در ایجاد درخواست پرداخت');
  }

  return response.json();
}

export {
  getSession,
  saveSession,
  clearSession,
  requestOtp,
  verifyOtp,
  legacyLogin,
  fetchLessons,
  fetchInstallments,
  fetchStatus,
  payOnline,
};
