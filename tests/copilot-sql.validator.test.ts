import { validateCopilotSql as v } from '../copilot-sql';
type C = [ 'crm'|'site', string, boolean ];
const cases: C[] = [
 ['crm','SELECT COUNT(*) AS total FROM students',true],
 ['crm','SELECT student_id FROM students ORDER BY student_id DESC LIMIT 5',true],
 ['site',"SELECT status, COUNT(*) AS n FROM registrations GROUP BY status",true],
 ['crm','UPDATE students SET name=1',false],
 ['crm','DELETE FROM students',false],
 ['crm','INSERT INTO students(student_id) VALUES(1)',false],
 ['crm','DROP TABLE students',false],
 ['crm','SELECT 1; DROP TABLE students',false],
 ['crm','SELECT * FROM students -- x',false],
 ['crm','SELECT * FROM students /* x */',false],
 ['crm','SELECT SLEEP(5)',false],
 ['crm','SELECT * FROM directus_users',false],
 ['crm','SELECT * FROM academy_settings',false],
 ['crm','SELECT * FROM mysql.user',false],
 ['crm','SELECT * FROM information_schema.tables',false],
 ['crm','SELECT * FROM payments',false],
 ['crm','SELECT authority FROM payments',false],
 ['crm','SELECT password FROM students',false],
 ['crm','SELECT * INTO OUTFILE "/tmp/x" FROM students',false],
 ['crm','SELECT * FROM students FOR UPDATE',false],
 ['crm','SELECT LOAD_FILE("/etc/passwd")',false],
 ['site','SELECT * FROM sqlite_master',false],
 ['site','PRAGMA table_info(users)',false],
 ['site','SELECT authority FROM course_payments',false],
 ['site','SELECT * FROM course_payments',false],
 ['site','SELECT * FROM unknown_t',false],
 ['crm','SELECT * FROM nodejs430_carla.directus_users',false],
 // alias cases
 ['site','SELECT status, COUNT(*) AS count FROM registrations GROUP BY status',true],
 ['crm','SELECT COUNT(*) AS count FROM students',true],
 ['crm','SELECT pay_date_jalali AS date, SUM(amount) AS sum FROM payments GROUP BY pay_date_jalali ORDER BY date',true],
 ['crm',"SELECT 'AS count' AS count FROM students",true],
 ['crm','SELECT authority AS count FROM payments',false],
 ['crm','SELECT password AS count FROM students',false],
 ['crm','SELECT COUNT(*) AS count FROM directus_users',false],
 ['site','SELECT COUNT(*) AS count FROM sqlite_master',false],
 ['site','SELECT authority AS count FROM course_payments',false],
 ['site','SELECT COUNT(*) AS count FROM directus_users',false],
 ['site','SELECT CAST(id AS TEXT) AS date FROM registrations',true],
 ['crm','DELETE FROM students WHERE student_id IN (SELECT student_id AS count FROM students)',false],
];
let fail=0;
for (const [db,q,exp] of cases){ const r:any=v(db,q); const ok=r.ok===exp; if(!ok)fail++;
 console.log(ok?'PASS':'FAIL', db, exp?'allow':'deny', '|', q.slice(0,70), r.ok? '=> '+r.sql.slice(0,70):'=> '+r.reason.slice(0,60)); }
console.log(`${cases.length-fail}/${cases.length} passed`); process.exit(fail?1:0);
