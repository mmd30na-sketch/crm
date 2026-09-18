-- =============================================================================
-- seed_data.sql â€” generated from MS Access (finaL.accde)
-- Source : D:\backup Daftar\StudentFiles\finaL.accdb
-- Created: 2026-07-20 09:47:15
-- Target : schema_postgresql.sql (students, courses, enrollments, payments, expenses)
-- =============================================================================

BEGIN;

-- Disable FKs temporarily only if needed; prefer insert order instead.
-- Insert order: students -> courses -> enrollments -> payments -> expenses

-- ---------------------------------------------------------------------------
-- students (Access: TblStudents)
-- ---------------------------------------------------------------------------
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (118, 'علی', 'دلیری', '3241913562', '09398606919', 'حافظیه ، 17 متری دوم لاله 62 ، پلاک 20', 'دلیری.png', 'دلیری118_Photo.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (120, 'آرمین', 'بهرامی نجوبرانی', '3242293908', '09185915152', 'فاقد', '-2147483648_-210108.jpg', 'photo23662835641.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (121, 'بهنام', 'ملک خطابی', '3256398073', '09358960630', 'فاقد', 'photo23658127592.jpg', '۲۰۲۶۰۱۰۷_۱۱۲۶۳۷.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (122, 'مجتبی', 'کرمی', '3411554238', '09188327001', 'فاقد', 'کرمی ملی.jpg', '775d23ae-5b3f-480e-9b8f-4a848c387302.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (124, 'سعید', 'حشمتیان', '3259046976', '09181307237', 'کارمندان ، ایستگاه 7 ، بن بست اندیشه', 'حشمتیان.jpg', NULL);
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (127, 'علی رضا', 'امینی', '3341554238', '09189252804', NULL, 'امینی کارت.jpg', 'امینی.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (128, 'محمد رضا', 'سیفی', '3242056523', '09182066448', NULL, 'سیفی ملی.jpg', 'سیفی (1).jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (131, 'تست', 'تصست', NULL, NULL, NULL, 'تصست_131_ID.jpg', NULL);
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (132, 'مهران', 'عباسی ظلانی', '3242008243', '09391816162', 'میدان جمهوری اسلامی ، چهارده متری امینی ، کوچه نهم پلاک 16', 'عباسی.jpg', NULL);
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (133, '', '', NULL, NULL, NULL, NULL, NULL);
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (134, 'طیب', 'پارسیان طیب', '3257549539', '09189213002', 'کرمانشاه ، خیابان دانشجو ، تپه فتحلی خان ، پلاک 179', 'پارسیان طیب.jpg', 'طیب پارسیان عکس.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (135, 'امیر', 'کریمی علی گرزانی', '4969696284', '09185526457', 'صحنه ، روستای علی گرزان سوفا', 'کریمی.2.jpg', 'کریمی.1.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (137, 'تست جدید', 'تست', '1223333332', '09888888888', 'سسس', NULL, NULL);
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (143, 'یزدان', 'خانی', '3258363862', '09389278110', NULL, 'IMG_20260310_135850_384.jpg', 'IMG_20260310_135917_446.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (144, 'فرشاد', 'قاسمی', '3257514840', '09188855878', NULL, 'IMG_20260409_125913_295.jpg;IMG_20260409_125913_295.png', NULL);
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (145, 'فرشاد', 'قاسمی', '3257514840', '09188855878', NULL, 'IMG_20260409_125913_295.png', 'IMG_20260406_094357_986.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (146, 'فرشاد', 'قاسمی', '3257514840', '09188855878', 'کرمانشاه', 'IMG_20260409_125913_295.png', 'IMG_20260406_094357_986.jpg');
INSERT INTO students (student_id, first_name, last_name, national_code, phone_number, address, id_card_photo, personal_photo) VALUES (147, 'مسغود
مسعود', 'شمس ز|د', '3255942276', '09183300481', '22بهمن کوی 314 پ 21 مجنمع |میران', 'Screenshot (1).png', 'Screenshot (1).png');

-- ---------------------------------------------------------------------------
-- courses (Access: TblCourse)
-- ---------------------------------------------------------------------------
INSERT INTO courses (course_id, title, price, is_active) VALUES (1, ' حمل و نقل جاده ای', 4700000, TRUE);
INSERT INTO courses (course_id, title, price, is_active) VALUES (2, 'محموله خطرناک', 3300000, TRUE);
INSERT INTO courses (course_id, title, price, is_active) VALUES (3, 'اتوبوس برون شهری', 4700000, TRUE);
INSERT INTO courses (course_id, title, price, is_active) VALUES (4, 'مدیر شرکت حمل و نقل', 4000000, TRUE);
INSERT INTO courses (course_id, title, price, is_active) VALUES (5, 'مدیر شرکت مسافر برون شهری', 5700000, TRUE);
INSERT INTO courses (course_id, title, price, is_active) VALUES (6, 'مسئول فنی', 4000000, TRUE);

-- ---------------------------------------------------------------------------
-- enrollments (Access: TblEnroll)
-- ---------------------------------------------------------------------------
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (127, 118, 1, 1, '1404/11/25', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (128, 120, 1, 1, '1404/10/23', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (129, 121, 1, 1, '1404/11/27', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (130, 122, 2, 1, '1404/11/27', 3300000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (131, 124, 1, 1, '1404/11/27', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (133, 127, 2, 1, '1404/11/28', 3300000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (134, 128, 1, 1, '1404/11/28', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (136, 132, 1, 2, '1404/12/01', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (137, NULL, 1, NULL, '1404/12/02', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (138, 134, 1, 2, '1405/01/07', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (139, 135, 1, 2, '1405/01/16', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (140, NULL, 5, NULL, '1405/01/17', 5700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (145, 143, 1, 2, '1405/01/20', 4700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (146, 145, 4, 2, '1405/01/20', 4000000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (147, 146, 5, 2, '1405/01/20', 5700000, 0.0000);
INSERT INTO enrollments (enrollment_id, student_id, course_id, course_number, signup_date_jalali, final_price, amount_paid) VALUES (148, 147, 1, 2, '1405/01/24', 4700000, 0.0000);

-- ---------------------------------------------------------------------------
-- payments (Access: TblPeyment)
-- ---------------------------------------------------------------------------
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (67, 138, 134, '1405/01/07', 4700000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (68, 139, 135, '1405/01/16', 1000, 'کارت به کارت', 'پيش پرداخت', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (73, 145, 143, '1405/01/20', 4700000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (74, 146, 145, '1405/01/20', 4000000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (75, 147, 146, '1405/01/20', 5700000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (76, 148, 147, '1405/01/24', 0.0000, 'نقدي', 'پيش پرداخت', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (53, 127, 118, '1404/11/25', 4700000, 'کارتخوان', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (54, 128, 120, '1404/10/23', 4700000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (55, 129, 121, '1404/11/27', 4700000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (56, 130, 122, '1404/11/27', 3300000, 'کارتخوان', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (57, 131, 124, '1404/11/27', 4700000, 'کارتخوان', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (59, 133, 127, '1404/11/28', 3300000, 'کارتخوان', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (60, 134, 128, '1404/11/28', 4700000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (62, 136, 132, '1404/12/01', 4700000, 'کارت به کارت', 'تسويه کامل', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (63, NULL, NULL, '1404/12/02', 0.0000, NULL, 'پيش پرداخت', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (64, NULL, NULL, '1404/12/02', 0.0000, NULL, 'پيش پرداخت', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (65, NULL, NULL, '1404/12/02', 0.0000, NULL, 'پيش پرداخت', NULL);
INSERT INTO payments (payment_id, enrollment_id, student_id, pay_date_jalali, amount, pay_method, payment_kind, description) VALUES (66, NULL, 133, '1404/12/02', 6548, NULL, 'تسويه کامل', NULL);

-- ---------------------------------------------------------------------------
-- expenses (Access: Tblexpenses)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Reset sequences to MAX(id)
-- ---------------------------------------------------------------------------
SELECT setval(pg_get_serial_sequence('students', 'student_id'), COALESCE((SELECT MAX(student_id) FROM students), 1));
SELECT setval(pg_get_serial_sequence('courses', 'course_id'), COALESCE((SELECT MAX(course_id) FROM courses), 1));
SELECT setval(pg_get_serial_sequence('enrollments', 'enrollment_id'), COALESCE((SELECT MAX(enrollment_id) FROM enrollments), 1));
SELECT setval(pg_get_serial_sequence('payments', 'payment_id'), COALESCE((SELECT MAX(payment_id) FROM payments), 1));
SELECT setval(pg_get_serial_sequence('expenses', 'expense_id'), COALESCE((SELECT MAX(expense_id) FROM expenses), 1));

COMMIT;

-- Row counts at extraction:
--   students : 18
--   courses : 6
--   enrollments : 16
--   payments : 18
--   expenses : 0
