-- Migration: Dynamic report template registry
-- See docs/report_template_registry.md
-- MySQL 8+

CREATE TABLE IF NOT EXISTS report_templates (
    template_id           INT            NOT NULL AUTO_INCREMENT,
    template_key          VARCHAR(64)    NOT NULL
        COMMENT 'Stable key: contract, receipt, id_card',
    title_fa              VARCHAR(255)   NOT NULL
        COMMENT 'Checkbox / UI title',
    description_fa        VARCHAR(512)   NULL,
    category              VARCHAR(64)    NOT NULL DEFAULT 'enrollment'
        COMMENT 'enrollment|payment|student|accounting',
    is_active             TINYINT(1)     NOT NULL DEFAULT 1
        COMMENT '1 = listed for operators and allowed to generate',
    is_default_selected   TINYINT(1)     NOT NULL DEFAULT 0
        COMMENT '1 = checked by default after signup',
    sort_order            INT            NOT NULL DEFAULT 100
        COMMENT 'UI and print order ascending',
    paper_size            VARCHAR(16)    NOT NULL DEFAULT 'a5'
        COMMENT 'a4|a5|thermal_80|inherit',
    orientation           VARCHAR(16)    NOT NULL DEFAULT 'portrait'
        COMMENT 'portrait|landscape',
    body_html             MEDIUMTEXT     NOT NULL
        COMMENT 'HTML fragment with {{placeholders}}',
    body_css              TEXT           NULL
        COMMENT 'Optional extra CSS scoped to this template',
    placeholders_schema   JSON           NULL
        COMMENT 'Array of {key,label_fa,required}',
    engine                VARCHAR(32)    NOT NULL DEFAULT 'html_client'
        COMMENT 'html_client|html_server|pdfkit',
    copies_default        INT            NOT NULL DEFAULT 1
        COMMENT 'Default copies for this template (1..5)',
    version               INT            NOT NULL DEFAULT 1
        COMMENT 'Bump when body changes (cache bust)',
    created_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (template_id),
    UNIQUE KEY uq_report_templates_key (template_key),
    KEY idx_report_templates_active_sort (is_active, category, sort_order),
    CONSTRAINT chk_report_templates_paper
        CHECK (paper_size IN ('a4', 'a5', 'thermal_80', 'inherit')),
    CONSTRAINT chk_report_templates_orientation
        CHECK (orientation IN ('portrait', 'landscape')),
    CONSTRAINT chk_report_templates_copies
        CHECK (copies_default >= 1 AND copies_default <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Dynamic CRM report/print template registry';

-- Optional: per-enrollment generated files (one row per template output)
CREATE TABLE IF NOT EXISTS enrollment_documents (
    document_id       INT            NOT NULL AUTO_INCREMENT,
    enrollment_id     INT            NOT NULL,
    template_id       INT            NOT NULL,
    template_key      VARCHAR(64)    NOT NULL,
    file_path         VARCHAR(512)   NOT NULL
        COMMENT 'Relative path under STORAGE_PATH',
    sha256            CHAR(64)       NULL,
    paper_size        VARCHAR(16)    NULL,
    generated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    generated_by      INT            NULL
        COMMENT 'Optional staff user id',

    PRIMARY KEY (document_id),
    UNIQUE KEY uq_enrollment_template (enrollment_id, template_key),
    KEY idx_enrollment_documents_enrollment (enrollment_id),
    CONSTRAINT fk_enrollment_documents_enrollment
        FOREIGN KEY (enrollment_id) REFERENCES enrollments (enrollment_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_enrollment_documents_template
        FOREIGN KEY (template_id) REFERENCES report_templates (template_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Generated PDF/HTML artifacts per enrollment and template';

-- ---------------------------------------------------------------------------
-- Seed: Access-equivalent reports (minimal RTL HTML bodies)
-- ---------------------------------------------------------------------------

INSERT INTO report_templates (
  template_key, title_fa, description_fa, category,
  is_active, is_default_selected, sort_order,
  paper_size, orientation, body_html, body_css, placeholders_schema,
  engine, copies_default, version
) VALUES
(
  'contract',
  'قرارداد آموزش',
  'قرارداد ثبت‌نام دوره (معادل Access Report2)',
  'enrollment',
  1, 1, 10,
  'a4', 'portrait',
  '<div class="doc doc--contract" dir="rtl" lang="fa">\n'
  '  <h1>قرارداد آموزش</h1>\n'
  '  <p>این قرارداد بین <strong>{{school_name}}</strong> و هنرجو '
  '  <strong>{{full_name}}</strong> (کدملی {{national_code}}) منعقد می‌گردد.</p>\n'
  '  <ul>\n'
  '    <li>دوره: {{course_title}}</li>\n'
  '    <li>شماره دوره: {{course_number}}</li>\n'
  '    <li>تاریخ ثبت‌نام: {{signup_date_jalali}}</li>\n'
  '    <li>مبلغ کل: {{final_price}} ریال</li>\n'
  '    <li>شماره پرونده: {{enrollment_id}}</li>\n'
  '  </ul>\n'
  '  <p class="doc__footer">{{footer_text}}</p>\n'
  '</div>',
  NULL,
  JSON_ARRAY(
    JSON_OBJECT('key', 'full_name', 'label_fa', 'نام کامل', 'required', true),
    JSON_OBJECT('key', 'first_name', 'label_fa', 'نام', 'required', true),
    JSON_OBJECT('key', 'last_name', 'label_fa', 'نام خانوادگی', 'required', true),
    JSON_OBJECT('key', 'national_code', 'label_fa', 'کد ملی', 'required', false),
    JSON_OBJECT('key', 'course_title', 'label_fa', 'عنوان دوره', 'required', true),
    JSON_OBJECT('key', 'course_number', 'label_fa', 'شماره دوره', 'required', false),
    JSON_OBJECT('key', 'signup_date_jalali', 'label_fa', 'تاریخ ثبت‌نام', 'required', false),
    JSON_OBJECT('key', 'final_price', 'label_fa', 'مبلغ نهایی', 'required', false),
    JSON_OBJECT('key', 'enrollment_id', 'label_fa', 'شماره ثبت‌نام', 'required', false),
    JSON_OBJECT('key', 'school_name', 'label_fa', 'نام آموزشگاه', 'required', false),
    JSON_OBJECT('key', 'footer_text', 'label_fa', 'پاورقی', 'required', false)
  ),
  'html_client', 1, 1
),
(
  'receipt',
  'رسید پرداخت',
  'رسید مالی ثبت‌نام (معادل Access Report3)',
  'enrollment',
  1, 1, 20,
  'a5', 'portrait',
  '<div class="doc doc--receipt" dir="rtl" lang="fa">\n'
  '  <header><h1>رسید پرداخت</h1><p>{{school_name}} — {{school_phone}}</p></header>\n'
  '  <p><span>هنرجو:</span> <strong>{{full_name}}</strong></p>\n'
  '  <p><span>کدملی:</span> {{national_code}}</p>\n'
  '  <p><span>دوره:</span> {{course_title}} ({{course_number}})</p>\n'
  '  <p><span>تاریخ:</span> {{pay_date_jalali}}</p>\n'
  '  <p><span>مبلغ کل:</span> {{final_price}}</p>\n'
  '  <p><span>پرداخت‌شده:</span> {{amount_paid}}</p>\n'
  '  <p><span>مانده:</span> {{balance}}</p>\n'
  '  <p><span>روش:</span> {{pay_method}} / {{payment_kind}}</p>\n'
  '  <p><span>شماره ثبت‌نام:</span> {{enrollment_id}}</p>\n'
  '  <footer>{{footer_text}}</footer>\n'
  '</div>',
  NULL,
  JSON_ARRAY(
    JSON_OBJECT('key', 'full_name', 'label_fa', 'نام کامل', 'required', true),
    JSON_OBJECT('key', 'national_code', 'label_fa', 'کد ملی', 'required', false),
    JSON_OBJECT('key', 'course_title', 'label_fa', 'عنوان دوره', 'required', true),
    JSON_OBJECT('key', 'course_number', 'label_fa', 'شماره دوره', 'required', false),
    JSON_OBJECT('key', 'final_price', 'label_fa', 'مبلغ نهایی', 'required', false),
    JSON_OBJECT('key', 'amount_paid', 'label_fa', 'پرداخت‌شده', 'required', false),
    JSON_OBJECT('key', 'balance', 'label_fa', 'مانده', 'required', false),
    JSON_OBJECT('key', 'pay_method', 'label_fa', 'روش پرداخت', 'required', false),
    JSON_OBJECT('key', 'payment_kind', 'label_fa', 'نوع پرداخت', 'required', false),
    JSON_OBJECT('key', 'pay_date_jalali', 'label_fa', 'تاریخ پرداخت', 'required', false),
    JSON_OBJECT('key', 'enrollment_id', 'label_fa', 'شماره ثبت‌نام', 'required', false),
    JSON_OBJECT('key', 'school_name', 'label_fa', 'نام آموزشگاه', 'required', false),
    JSON_OBJECT('key', 'school_phone', 'label_fa', 'تلفن', 'required', false),
    JSON_OBJECT('key', 'footer_text', 'label_fa', 'پاورقی', 'required', false)
  ),
  'html_client', 1, 1
),
(
  'id_card',
  'کارت شناسایی هنرجو',
  'کارت شناسایی (معادل Access Report4)',
  'enrollment',
  1, 0, 30,
  'a5', 'landscape',
  '<div class="doc doc--idcard" dir="rtl" lang="fa">\n'
  '  <h1>کارت شناسایی هنرجو</h1>\n'
  '  <p><strong>{{full_name}}</strong></p>\n'
  '  <p>کدملی: {{national_code}}</p>\n'
  '  <p>دوره: {{course_title}}</p>\n'
  '  <p>شماره دوره: {{course_number}}</p>\n'
  '  <p>پرونده: {{student_id}} / {{enrollment_id}}</p>\n'
  '  <p>{{school_name}}</p>\n'
  '</div>',
  NULL,
  JSON_ARRAY(
    JSON_OBJECT('key', 'full_name', 'label_fa', 'نام کامل', 'required', true),
    JSON_OBJECT('key', 'national_code', 'label_fa', 'کد ملی', 'required', false),
    JSON_OBJECT('key', 'course_title', 'label_fa', 'عنوان دوره', 'required', true),
    JSON_OBJECT('key', 'course_number', 'label_fa', 'شماره دوره', 'required', false),
    JSON_OBJECT('key', 'student_id', 'label_fa', 'شناسه هنرجو', 'required', false),
    JSON_OBJECT('key', 'enrollment_id', 'label_fa', 'شماره ثبت‌نام', 'required', false),
    JSON_OBJECT('key', 'school_name', 'label_fa', 'نام آموزشگاه', 'required', false)
  ),
  'html_client', 1, 1
)
ON DUPLICATE KEY UPDATE
  title_fa = VALUES(title_fa),
  description_fa = VALUES(description_fa),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order),
  paper_size = VALUES(paper_size),
  body_html = VALUES(body_html),
  placeholders_schema = VALUES(placeholders_schema),
  version = VALUES(version);
