/** Fallback report templates when DB is empty or unavailable */

export type ReportTemplateRow = {
  template_id: number;
  template_key: string;
  title_fa: string;
  description_fa: string | null;
  category: string;
  is_active: number;
  is_default_selected: number;
  sort_order: number;
  paper_size: string;
  orientation: string;
  body_html: string;
  body_css: string | null;
  placeholders_schema: unknown;
  engine: string;
  copies_default: number;
  version: number;
};

export const DEFAULT_REPORT_TEMPLATES: ReportTemplateRow[] = [
  {
    template_id: -1,
    template_key: 'contract',
    title_fa: 'قرارداد آموزش',
    description_fa: 'قرارداد ثبت‌نام دوره (Report2)',
    category: 'enrollment',
    is_active: 1,
    is_default_selected: 1,
    sort_order: 10,
    paper_size: 'a4',
    orientation: 'portrait',
    body_html: `<div class="doc doc--contract" dir="rtl" lang="fa">
  <h1>قرارداد آموزش</h1>
  <p>این قرارداد بین <strong>{{school_name}}</strong> و هنرجو
  <strong>{{full_name}}</strong> (کدملی {{national_code}}) منعقد می‌گردد.</p>
  <ul>
    <li>دوره: {{course_title}}</li>
    <li>شماره دوره: {{course_number}}</li>
    <li>تاریخ ثبت‌نام: {{signup_date_jalali}}</li>
    <li>مبلغ کل: {{final_price}} ریال</li>
    <li>شماره پرونده: {{enrollment_id}}</li>
  </ul>
  <p class="doc__footer">{{footer_text}}</p>
</div>`,
    body_css: null,
    placeholders_schema: null,
    engine: 'html_client',
    copies_default: 1,
    version: 1,
  },
  {
    template_id: -2,
    template_key: 'receipt',
    title_fa: 'رسید پرداخت',
    description_fa: 'رسید مالی ثبت‌نام (Report3)',
    category: 'enrollment',
    is_active: 1,
    is_default_selected: 1,
    sort_order: 20,
    paper_size: 'a5',
    orientation: 'portrait',
    body_html: `<div class="doc doc--receipt" dir="rtl" lang="fa">
  <header><h1>رسید پرداخت</h1><p>{{school_name}} — {{school_phone}}</p></header>
  <p><span>هنرجو:</span> <strong>{{full_name}}</strong></p>
  <p><span>کدملی:</span> {{national_code}}</p>
  <p><span>دوره:</span> {{course_title}} ({{course_number}})</p>
  <p><span>تاریخ:</span> {{pay_date_jalali}}</p>
  <p><span>مبلغ کل:</span> {{final_price}}</p>
  <p><span>پرداخت‌شده:</span> {{amount_paid}}</p>
  <p><span>مانده:</span> {{balance}}</p>
  <p><span>روش:</span> {{pay_method}} / {{payment_kind}}</p>
  <p><span>شماره ثبت‌نام:</span> {{enrollment_id}}</p>
  <footer>{{footer_text}}</footer>
</div>`,
    body_css: null,
    placeholders_schema: null,
    engine: 'html_client',
    copies_default: 1,
    version: 1,
  },
  {
    template_id: -3,
    template_key: 'id_card',
    title_fa: 'کارت شناسایی هنرجو',
    description_fa: 'کارت شناسایی (Report4)',
    category: 'enrollment',
    is_active: 1,
    is_default_selected: 0,
    sort_order: 30,
    paper_size: 'a5',
    orientation: 'landscape',
    body_html: `<div class="doc doc--idcard" dir="rtl" lang="fa">
  <h1>کارت شناسایی هنرجو</h1>
  <p><strong>{{full_name}}</strong></p>
  <p>کدملی: {{national_code}}</p>
  <p>دوره: {{course_title}}</p>
  <p>شماره دوره: {{course_number}}</p>
  <p>پرونده: {{student_id}} / {{enrollment_id}}</p>
  <p>{{school_name}}</p>
</div>`,
    body_css: null,
    placeholders_schema: null,
    engine: 'html_client',
    copies_default: 1,
    version: 1,
  },
];
