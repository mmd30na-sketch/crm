-- =============================================================================
-- PostgreSQL schema — StudentFiles / finaL.accde migration
-- Source: MS Access (db_schema_and_samples.txt)
-- Compatible with: PostgreSQL 14+
-- Naming: snake_case (clean SQL); original Access names noted in COMMENT
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions (optional but useful)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid() if needed later

-- ---------------------------------------------------------------------------
-- Drop (dev / re-run only — comment out in production migrate)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS registrations CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS otp_codes CASCADE;
DROP TABLE IF EXISTS staff_users CASCADE;

-- =============================================================================
-- 1. students  (Access: TblStudents)
-- =============================================================================
CREATE TABLE students (
    student_id          SERIAL PRIMARY KEY,                    -- StudentID
    first_name          VARCHAR(100)  NOT NULL,                -- firstName
    last_name           VARCHAR(100)  NOT NULL,                -- lastName
    national_code       VARCHAR(20),                           -- Ncode (کد ملی)
    phone_number        VARCHAR(30),                           -- phoneNumber
    address             TEXT,                                  -- Address
    id_card_photo       VARCHAR(255),                          -- IdCartPht (filename/path)
    personal_photo      VARCHAR(255),                          -- PersonalPht (filename/path)
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- CONSTRAINT uq_students_national_code
    --     UNIQUE (national_code),
    CONSTRAINT chk_students_national_code
        CHECK (national_code IS NULL OR national_code ~ '^\d{10}$'),
    CONSTRAINT chk_students_phone
        CHECK (phone_number IS NULL OR length(trim(phone_number)) >= 10)
);

COMMENT ON TABLE  students IS 'Access: TblStudents — هنرجویان / students';
COMMENT ON COLUMN students.student_id     IS 'Access: StudentID';
COMMENT ON COLUMN students.national_code  IS 'Access: Ncode — Iranian national ID (10 digits)';
COMMENT ON COLUMN students.id_card_photo  IS 'Access: IdCartPht — ID card image filename';
COMMENT ON COLUMN students.personal_photo IS 'Access: PersonalPht — personal photo filename';

CREATE INDEX idx_students_phone        ON students (phone_number);
CREATE INDEX idx_students_last_name    ON students (last_name);
CREATE INDEX idx_students_full_name    ON students (last_name, first_name);

-- =============================================================================
-- 2. courses  (Access: TblCourse)
-- =============================================================================
CREATE TABLE courses (
    course_id           SERIAL PRIMARY KEY,                    -- course ID
    title               VARCHAR(255)  NOT NULL,                -- course
    price               NUMERIC(15, 2) NOT NULL DEFAULT 0,     -- price (Currency)
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_courses_price CHECK (price >= 0)
);

COMMENT ON TABLE  courses IS 'Access: TblCourse — دوره‌های آموزشی';
COMMENT ON COLUMN courses.course_id IS 'Access: course ID';
COMMENT ON COLUMN courses.title     IS 'Access: course';
COMMENT ON COLUMN courses.price     IS 'Access: price (IRR / تومان as used in app)';

CREATE INDEX idx_courses_title ON courses (title);

-- =============================================================================
-- 3. enrollments  (Access: TblEnroll)
-- =============================================================================
CREATE TABLE enrollments (
    enrollment_id       SERIAL PRIMARY KEY,                    -- ID
    student_id          INTEGER,                               -- studentRef
    course_id           INTEGER       NOT NULL,                -- courseRef
    course_number       INTEGER,                               -- courseNumber (دوره/ترم)
    signup_date_jalali  VARCHAR(20),                           -- detaSignUp (e.g. 1404/11/25)
    final_price         NUMERIC(15, 2),                        -- finalCoursePrice
    amount_paid         NUMERIC(15, 4) NOT NULL DEFAULT 0,     -- payment
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

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
);

COMMENT ON TABLE  enrollments IS 'Access: TblEnroll — ثبت‌نام دوره';
COMMENT ON COLUMN enrollments.enrollment_id      IS 'Access: ID';
COMMENT ON COLUMN enrollments.student_id         IS 'Access: studentRef → TblStudents.StudentID';
COMMENT ON COLUMN enrollments.course_id          IS 'Access: courseRef → TblCourse.course ID';
COMMENT ON COLUMN enrollments.course_number      IS 'Access: courseNumber';
COMMENT ON COLUMN enrollments.signup_date_jalali IS 'Access: detaSignUp — Jalali date as text YYYY/MM/DD';
COMMENT ON COLUMN enrollments.final_price        IS 'Access: finalCoursePrice';
COMMENT ON COLUMN enrollments.amount_paid        IS 'Access: payment — cumulative paid amount';

CREATE INDEX idx_enrollments_student   ON enrollments (student_id);
CREATE INDEX idx_enrollments_course    ON enrollments (course_id);
CREATE INDEX idx_enrollments_signup    ON enrollments (signup_date_jalali);
CREATE INDEX idx_enrollments_student_course ON enrollments (student_id, course_id);

-- =============================================================================
-- 4. payments  (Access: TblPeyment)  [typo preserved only in COMMENT]
-- =============================================================================
CREATE TABLE payments (
    payment_id          SERIAL PRIMARY KEY,                    -- ID
    enrollment_id       INTEGER,                               -- EnrollRef (NULL if unlinked; Access used 0)
    student_id          INTEGER,                               -- RefStudentID
    pay_date_jalali     VARCHAR(20),                           -- Paydate (e.g. 1405/01/07)
    amount              NUMERIC(15, 2) NOT NULL,               -- amount
    pay_method          VARCHAR(100),                          -- paytype (کارتخوان, کارت به کارت, آنلاین, ...)
    payment_kind        VARCHAR(100),                          -- type (تسويه کامل, پيش پرداخت, ...)
    gateway_name        VARCHAR(50),                           -- Payment gateway (zarinpal, idpay, mellat, ...)
    authority           VARCHAR(255),                          -- Online gateway authority / token
    ref_id              VARCHAR(100),                          -- Online gateway bank reference ID
    card_pan            VARCHAR(30),                           -- Masked card number e.g. 6037****1234
    description         TEXT,                                  -- description
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_payments_enrollment
        FOREIGN KEY (enrollment_id) REFERENCES enrollments (enrollment_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_payments_student
        FOREIGN KEY (student_id) REFERENCES students (student_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payments_amount CHECK (amount >= 0)
);

COMMENT ON TABLE  payments IS 'Access: TblPeyment — پرداخت‌ها';
COMMENT ON COLUMN payments.payment_id      IS 'Access: ID';
COMMENT ON COLUMN payments.enrollment_id   IS 'Access: EnrollRef — 0 in Access mapped to NULL';
COMMENT ON COLUMN payments.student_id      IS 'Access: RefStudentID';
COMMENT ON COLUMN payments.pay_date_jalali IS 'Access: Paydate — Jalali date as text';
COMMENT ON COLUMN payments.pay_method      IS 'Access: paytype';
COMMENT ON COLUMN payments.payment_kind    IS 'Access: type (full settlement / prepay / ...)';
COMMENT ON COLUMN payments.gateway_name    IS 'Payment gateway name';
COMMENT ON COLUMN payments.authority       IS 'Online gateway authority token';
COMMENT ON COLUMN payments.ref_id          IS 'Bank reference ID';
COMMENT ON COLUMN payments.card_pan        IS 'Masked card number';

CREATE INDEX idx_payments_enrollment ON payments (enrollment_id);
CREATE INDEX idx_payments_student    ON payments (student_id);
CREATE INDEX idx_payments_date       ON payments (pay_date_jalali);
CREATE INDEX idx_payments_method     ON payments (pay_method);
CREATE INDEX idx_payments_ref_id     ON payments (ref_id);

-- =============================================================================
-- 5. expenses  (Access: Tblexpenses)
-- =============================================================================
CREATE TABLE expenses (
    expense_id          SERIAL PRIMARY KEY,                    -- expnseID
    title               VARCHAR(255)  NOT NULL,                -- expenseTitle
    amount              NUMERIC(15, 2) NOT NULL,               -- expenseAmount
    expense_date_jalali VARCHAR(20),                           -- expensedate
    description         TEXT,                                  -- description
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_expenses_amount CHECK (amount >= 0)
);

COMMENT ON TABLE  expenses IS 'Access: Tblexpenses — هزینه‌ها';
COMMENT ON COLUMN expenses.expense_id          IS 'Access: expnseID';
COMMENT ON COLUMN expenses.title               IS 'Access: expenseTitle';
COMMENT ON COLUMN expenses.amount              IS 'Access: expenseAmount';
COMMENT ON COLUMN expenses.expense_date_jalali IS 'Access: expensedate — Jalali date as text';

CREATE INDEX idx_expenses_date  ON expenses (expense_date_jalali);
CREATE INDEX idx_expenses_title ON expenses (title);

-- =============================================================================
-- 6. otp_codes  (app auth — present in MySQL nodejs430_carla, not in Access)
-- =============================================================================
CREATE TABLE otp_codes (
    id                  SERIAL PRIMARY KEY,
    phone_number        VARCHAR(15)   NOT NULL,
    code                VARCHAR(6)    NOT NULL,
    expires_at          TIMESTAMPTZ   NOT NULL,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE otp_codes IS 'OTP for phone login (app layer; not in MS Access)';

CREATE INDEX idx_otp_phone ON otp_codes (phone_number);
CREATE INDEX idx_otp_expires ON otp_codes (expires_at);

-- =============================================================================
-- 7. staff_users (CRM Admin & Operator users)
-- =============================================================================
CREATE TABLE staff_users (
    user_id             SERIAL PRIMARY KEY,
    username            VARCHAR(50)   NOT NULL UNIQUE,
    password_hash       VARCHAR(255)  NOT NULL,
    full_name           VARCHAR(100)  NOT NULL,
    role                VARCHAR(30)   NOT NULL DEFAULT 'operator',
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_staff_users_role CHECK (role IN ('admin', 'operator', 'accountant'))
);

COMMENT ON TABLE staff_users IS 'CRM Staff / Admin Users and Roles';

CREATE INDEX idx_staff_users_username ON staff_users (username);
CREATE INDEX idx_staff_users_role     ON staff_users (role);

-- =============================================================================
-- 8. registrations (Web & Local Online Registrations)
-- =============================================================================
CREATE TABLE registrations (
    registration_id     SERIAL PRIMARY KEY,
    tracking_code       VARCHAR(50)   NOT NULL UNIQUE,
    national_code       VARCHAR(20)   NOT NULL,
    full_name           VARCHAR(150)  NOT NULL,
    phone_number        VARCHAR(30)   NOT NULL,
    category            VARCHAR(100),
    academic_degree     VARCHAR(100),
    military_status     VARCHAR(100),
    has_temp_permit     BOOLEAN       NOT NULL DEFAULT FALSE,
    national_card_path  VARCHAR(255),
    personal_photo_path VARCHAR(255),
    status              VARCHAR(20)   NOT NULL DEFAULT 'pending',
    source              VARCHAR(20)   NOT NULL DEFAULT 'website',
    student_id          INTEGER,
    approved_by         INTEGER,
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

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
);

COMMENT ON TABLE registrations IS 'Web and Local online registration requests';

CREATE INDEX idx_registrations_tracking    ON registrations (tracking_code);
CREATE INDEX idx_registrations_phone       ON registrations (phone_number);
CREATE INDEX idx_registrations_national_id ON registrations (national_code);
CREATE INDEX idx_registrations_status      ON registrations (status);

-- =============================================================================
-- updated_at trigger helper
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_courses_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_enrollments_updated_at
    BEFORE UPDATE ON enrollments
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_registrations_updated_at
    BEFORE UPDATE ON registrations
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- =============================================================================
-- Optional view: enrollment balance (final_price vs sum of payments)
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

COMMENT ON VIEW v_enrollment_balances IS
    'Compares enrollments.amount_paid cache vs SUM(payments.amount)';

COMMIT;

-- =============================================================================
-- Name map (Access → PostgreSQL)
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
-- Tblexpenses.expenseTitle   → expenses.expenseTitle → expenses.title
-- Tblexpenses.expenseAmount  → expenses.amount
-- Tblexpenses.expensedate    → expenses.expense_date_jalali
-- Tblexpenses.description    → expenses.description
-- =============================================================================
