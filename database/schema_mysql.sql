-- =============================================================================
-- MySQL schema — StudentFiles / finaL.accde migration
-- Source: schema_postgresql.sql (converted)
-- Compatible with: MySQL 8.0+ / MariaDB 10.5+
-- Naming: snake_case; original Access names in COMMENT
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Drop (dev / re-run only — comment out in production migrate)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS staff_users;
DROP VIEW IF EXISTS v_enrollment_balances;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 1. students  (Access: TblStudents)
-- =============================================================================
CREATE TABLE students (
    student_id          INT            NOT NULL AUTO_INCREMENT COMMENT 'Access: StudentID',
    first_name          VARCHAR(100)   NOT NULL COMMENT 'Access: firstName',
    last_name           VARCHAR(100)   NOT NULL COMMENT 'Access: lastName',
    national_code       VARCHAR(20)    NULL COMMENT 'Access: Ncode — Iranian national ID (10 digits)',
    phone_number        VARCHAR(30)    NULL COMMENT 'Access: phoneNumber',
    address             TEXT           NULL COMMENT 'Access: Address',
    id_card_photo       VARCHAR(255)   NULL COMMENT 'Access: IdCartPht — ID card image filename',
    personal_photo      VARCHAR(255)   NULL COMMENT 'Access: PersonalPht — personal photo filename',
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (student_id),
    CONSTRAINT chk_students_national_code
        CHECK (national_code IS NULL OR national_code REGEXP '^[0-9]{10}$'),
    CONSTRAINT chk_students_phone
        CHECK (phone_number IS NULL OR CHAR_LENGTH(TRIM(phone_number)) >= 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Access: TblStudents — students / هنرجویان';

CREATE INDEX idx_students_phone     ON students (phone_number);
CREATE INDEX idx_students_last_name ON students (last_name);
CREATE INDEX idx_students_full_name ON students (last_name, first_name);

-- =============================================================================
-- 2. courses  (Access: TblCourse)
-- =============================================================================
CREATE TABLE courses (
    course_id           INT            NOT NULL AUTO_INCREMENT COMMENT 'Access: course ID',
    title               VARCHAR(255)   NOT NULL COMMENT 'Access: course',
    price               DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Access: price (IRR / تومان)',
    is_active           TINYINT(1)     NOT NULL DEFAULT 1,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (course_id),
    CONSTRAINT chk_courses_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Access: TblCourse — courses / دوره های آموزشی';

CREATE INDEX idx_courses_title ON courses (title);

-- =============================================================================
-- 3. enrollments  (Access: TblEnroll)
-- =============================================================================
CREATE TABLE enrollments (
    enrollment_id       INT            NOT NULL AUTO_INCREMENT COMMENT 'Access: ID',
    student_id          INT            NULL COMMENT 'Access: studentRef → TblStudents.StudentID',
    course_id           INT            NOT NULL COMMENT 'Access: courseRef → TblCourse.course ID',
    course_number       INT            NULL COMMENT 'Access: courseNumber',
    signup_date_jalali  VARCHAR(20)    NULL COMMENT 'Access: detaSignUp — Jalali date as text YYYY/MM/DD',
    final_price         DECIMAL(15, 2) NULL COMMENT 'Access: finalCoursePrice',
    amount_paid         DECIMAL(15, 4) NOT NULL DEFAULT 0.0000 COMMENT 'Access: payment — cumulative paid amount',
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (enrollment_id),
    CONSTRAINT fk_enrollments_student
        FOREIGN KEY (student_id) REFERENCES students (student_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_enrollments_course
        FOREIGN KEY (course_id) REFERENCES courses (course_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_enrollments_final_price
        CHECK (final_price IS NULL OR final_price >= 0),
    CONSTRAINT chk_enrollments_amount_paid
        CHECK (amount_paid >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Access: TblEnroll — enrollments / ثبت نام دوره';

CREATE INDEX idx_enrollments_student        ON enrollments (student_id);
CREATE INDEX idx_enrollments_course         ON enrollments (course_id);
CREATE INDEX idx_enrollments_signup         ON enrollments (signup_date_jalali);
CREATE INDEX idx_enrollments_student_course ON enrollments (student_id, course_id);

-- =============================================================================
-- 4. payments  (Access: TblPeyment)
-- =============================================================================
CREATE TABLE payments (
    payment_id          INT            NOT NULL AUTO_INCREMENT COMMENT 'Access: ID',
    enrollment_id       INT            NULL COMMENT 'Access: EnrollRef — 0 in Access mapped to NULL',
    student_id          INT            NULL COMMENT 'Access: RefStudentID',
    pay_date_jalali     VARCHAR(20)    NULL COMMENT 'Access: Paydate — Jalali date as text',
    amount              DECIMAL(15, 2) NOT NULL COMMENT 'Access: amount',
    pay_method          VARCHAR(100)   NULL COMMENT 'Access: paytype (کارتخوان, کارت به کارت, آنلاین, ...)',
    payment_kind        VARCHAR(100)   NULL COMMENT 'Access: type (تسويه کامل, پيش پرداخت, ...)',
    gateway_name        VARCHAR(50)    NULL COMMENT 'Payment gateway (zarinpal, idpay, mellat, ...)',
    authority           VARCHAR(255)   NULL COMMENT 'Online payment gateway authority / token',
    ref_id              VARCHAR(100)   NULL COMMENT 'Online payment bank reference / tracking ID',
    card_pan            VARCHAR(30)    NULL COMMENT 'Masked card number e.g. 6037****1234',
    description         TEXT           NULL COMMENT 'Access: description',
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (payment_id),
    CONSTRAINT fk_payments_enrollment
        FOREIGN KEY (enrollment_id) REFERENCES enrollments (enrollment_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_payments_student
        FOREIGN KEY (student_id) REFERENCES students (student_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payments_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Access: TblPeyment — payments / پرداخت ها';

CREATE INDEX idx_payments_enrollment ON payments (enrollment_id);
CREATE INDEX idx_payments_student    ON payments (student_id);
CREATE INDEX idx_payments_date       ON payments (pay_date_jalali);
CREATE INDEX idx_payments_method     ON payments (pay_method);
CREATE INDEX idx_payments_ref_id     ON payments (ref_id);

-- =============================================================================
-- 5. expenses  (Access: Tblexpenses)
-- =============================================================================
CREATE TABLE expenses (
    expense_id          INT            NOT NULL AUTO_INCREMENT COMMENT 'Access: expnseID',
    title               VARCHAR(255)   NOT NULL COMMENT 'Access: expenseTitle',
    amount              DECIMAL(15, 2) NOT NULL COMMENT 'Access: expenseAmount',
    expense_date_jalali VARCHAR(20)    NULL COMMENT 'Access: expensedate — Jalali date as text',
    description         TEXT           NULL COMMENT 'Access: description',
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (expense_id),
    CONSTRAINT chk_expenses_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Access: Tblexpenses — expenses / هزینه ها';

CREATE INDEX idx_expenses_date  ON expenses (expense_date_jalali);
CREATE INDEX idx_expenses_title ON expenses (title);

-- =============================================================================
-- 6. otp_codes  (app auth — not in MS Access)
-- =============================================================================
CREATE TABLE otp_codes (
    id                  INT            NOT NULL AUTO_INCREMENT,
    phone_number        VARCHAR(15)    NOT NULL,
    code                VARCHAR(6)     NOT NULL,
    expires_at          DATETIME       NOT NULL,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OTP for phone login (app layer; not in MS Access)';

CREATE INDEX idx_otp_phone   ON otp_codes (phone_number);
CREATE INDEX idx_otp_expires ON otp_codes (expires_at);

-- =============================================================================
-- 7. staff_users (CRM Admin & Operator users)
-- =============================================================================
CREATE TABLE staff_users (
    user_id             INT            NOT NULL AUTO_INCREMENT,
    username            VARCHAR(50)    NOT NULL UNIQUE COMMENT 'Login username',
    password_hash       VARCHAR(255)   NOT NULL COMMENT 'Bcrypt / Argon2 password hash',
    full_name           VARCHAR(100)   NOT NULL COMMENT 'Staff member full name',
    role                VARCHAR(30)    NOT NULL DEFAULT 'operator' COMMENT 'admin | operator | accountant',
    is_active           TINYINT(1)     NOT NULL DEFAULT 1,
    last_login_at       DATETIME       NULL,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id),
    CONSTRAINT chk_staff_users_role CHECK (role IN ('admin', 'operator', 'accountant'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CRM Staff / Admin Users and Roles';

CREATE INDEX idx_staff_users_username ON staff_users (username);
CREATE INDEX idx_staff_users_role     ON staff_users (role);

-- =============================================================================
-- 8. registrations (Web & Local Online Registrations)
-- =============================================================================
CREATE TABLE registrations (
    registration_id     INT            NOT NULL AUTO_INCREMENT COMMENT 'Primary Key',
    tracking_code       VARCHAR(50)    NOT NULL UNIQUE COMMENT 'Unique tracking code e.g. TRK-14050101-8923',
    national_code       VARCHAR(20)    NOT NULL COMMENT 'Iranian national ID (10 digits)',
    full_name           VARCHAR(150)   NOT NULL COMMENT 'Full name',
    phone_number        VARCHAR(30)    NOT NULL COMMENT 'Phone number',
    category            VARCHAR(100)   NULL COMMENT 'Category e.g. باری, مسافری, مسئول فنی',
    academic_degree     VARCHAR(100)   NULL COMMENT 'Degree e.g. دیپلم, لیسانس',
    military_status     VARCHAR(100)   NULL COMMENT 'Military status e.g. پایان خدمت, معافیت',
    has_temp_permit     TINYINT(1)     NOT NULL DEFAULT 0 COMMENT '1 if has temporary permit',
    national_card_path  VARCHAR(255)   NULL COMMENT 'Path to uploaded national card image',
    personal_photo_path VARCHAR(255)   NULL COMMENT 'Path to uploaded personal photo image',
    status              VARCHAR(20)    NOT NULL DEFAULT 'pending' COMMENT 'pending | approved | rejected',
    source              VARCHAR(20)    NOT NULL DEFAULT 'website' COMMENT 'website | local_crm',
    student_id          INT            NULL COMMENT 'Linked student_id upon approval',
    approved_by         INT            NULL COMMENT 'staff_users.user_id who approved/rejected',
    approved_at         DATETIME       NULL COMMENT 'Timestamp of approval/rejection',
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (registration_id),
    CONSTRAINT fk_registrations_student
        FOREIGN KEY (student_id) REFERENCES students (student_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_registrations_approved_by
        FOREIGN KEY (approved_by) REFERENCES staff_users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_registrations_status
        CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT chk_registrations_source
        CHECK (source IN ('website', 'local_crm'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Web and Local online registration requests';

CREATE INDEX idx_registrations_tracking    ON registrations (tracking_code);
CREATE INDEX idx_registrations_phone       ON registrations (phone_number);
CREATE INDEX idx_registrations_national_id ON registrations (national_code);
CREATE INDEX idx_registrations_status      ON registrations (status);

-- =============================================================================
-- View: enrollment balance (final_price vs sum of payments)
-- =============================================================================
CREATE OR REPLACE VIEW v_enrollment_balances AS
SELECT
    e.enrollment_id,
    e.student_id,
    e.course_id,
    e.signup_date_jalali,
    e.final_price,
    e.amount_paid AS amount_paid_cached,
    COALESCE(SUM(p.amount), 0) AS amount_paid_from_payments,
    e.final_price - COALESCE(SUM(p.amount), 0) AS balance_due
FROM enrollments e
LEFT JOIN payments p ON p.enrollment_id = e.enrollment_id
GROUP BY
    e.enrollment_id,
    e.student_id,
    e.course_id,
    e.signup_date_jalali,
    e.final_price,
    e.amount_paid;

-- =============================================================================
-- Name map (Access → MySQL)
-- =============================================================================
-- TblStudents.StudentID      → students.student_id
-- TblStudents.firstName      → students.first_name
-- TblStudents.lastName       → students.last_name
-- TblStudents.Ncode          → students.national_code
-- TblStudents.phoneNumber    → students.phone_number
-- TblStudents.Address        → students.address
-- TblStudents.IdCartPht      → students.id_card_photo
-- TblStudents.PersonalPht    → students.personal_photo
--
-- TblCourse.course ID        → courses.course_id
-- TblCourse.course           → courses.title
-- TblCourse.price            → courses.price
--
-- TblEnroll.ID               → enrollments.enrollment_id
-- TblEnroll.studentRef       → enrollments.student_id
-- TblEnroll.courseRef        → enrollments.course_id
-- TblEnroll.courseNumber     → enrollments.course_number
-- TblEnroll.detaSignUp       → enrollments.signup_date_jalali
-- TblEnroll.finalCoursePrice → enrollments.final_price
-- TblEnroll.payment          → enrollments.amount_paid
--
-- TblPeyment.ID              → payments.payment_id
-- TblPeyment.EnrollRef       → payments.enrollment_id  (0 → NULL)
-- TblPeyment.RefStudentID    → payments.student_id
-- TblPeyment.Paydate         → payments.pay_date_jalali
-- TblPeyment.amount          → payments.amount
-- TblPeyment.paytype         → payments.pay_method
-- TblPeyment.type            → payments.payment_kind
-- TblPeyment.description     → payments.description
--
-- Tblexpenses.expnseID       → expenses.expense_id
-- Tblexpenses.expenseTitle   → expenses.title
-- Tblexpenses.expenseAmount  → expenses.amount
-- Tblexpenses.expensedate    → expenses.expense_date_jalali
-- Tblexpenses.description    → expenses.description
-- =============================================================================
