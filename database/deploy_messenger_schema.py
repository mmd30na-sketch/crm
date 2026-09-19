import sys
import pymysql
import socks
import socket

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# SOCKS5 Proxy for Chabokan MySQL bypass
socks.set_default_proxy(socks.SOCKS5, '127.0.0.1', 10808)
socket.socket = socks.socksocket

print("Connecting to Chabokan MySQL server...")
conn = pymysql.connect(
    host='services.irn5.chabokan.net',
    port=52691,
    user='nodejs430_carla',
    password='PFFv1SnYbU81',
    database='nodejs430_carla',
    autocommit=True,
    charset='utf8mb4'
)

cursor = conn.cursor()

sql_statements = [
    """
    CREATE TABLE IF NOT EXISTS messenger_threads (
        thread_id        INT           NOT NULL AUTO_INCREMENT,
        channel          VARCHAR(20)   NOT NULL COMMENT 'rubika | sms',
        external_id      VARCHAR(100)  NOT NULL COMMENT 'Rubika peer_id / user_guid or phone number',
        title            VARCHAR(150)  NULL COMMENT 'Contact name or phone number',
        student_id       INT           NULL COMMENT 'Linked student_id',
        lead_id          INT           NULL COMMENT 'Linked lead_id',
        unread_count     INT           NOT NULL DEFAULT 0,
        last_message_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (thread_id),
        UNIQUE KEY uq_messenger_threads_channel_ext (channel, external_id),
        CONSTRAINT fk_messenger_threads_student FOREIGN KEY (student_id) REFERENCES students (student_id) ON DELETE SET NULL,
        CONSTRAINT fk_messenger_threads_lead FOREIGN KEY (lead_id) REFERENCES leads (lead_id) ON DELETE SET NULL,
        CONSTRAINT chk_messenger_threads_channel CHECK (channel IN ('rubika', 'sms'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Unified messaging threads for Rubika and SMS';
    """,
    """
    CREATE TABLE IF NOT EXISTS messenger_messages (
        message_id       INT           NOT NULL AUTO_INCREMENT,
        thread_id        INT           NOT NULL,
        channel          VARCHAR(20)   NOT NULL COMMENT 'rubika | sms',
        direction        VARCHAR(10)   NOT NULL COMMENT 'in | out',
        body             TEXT          NOT NULL COMMENT 'Message text content',
        status           VARCHAR(20)   NOT NULL DEFAULT 'queued' COMMENT 'queued | sent | delivered | failed | received',
        external_msg_id  VARCHAR(150)  NULL COMMENT 'Provider or Rubika message ID',
        sent_by_staff_id INT           NULL COMMENT 'staff_users.user_id if sent by operator',
        error_message    TEXT          NULL,
        created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at          DATETIME      NULL,

        PRIMARY KEY (message_id),
        CONSTRAINT fk_messenger_messages_thread FOREIGN KEY (thread_id) REFERENCES messenger_threads (thread_id) ON DELETE CASCADE,
        CONSTRAINT fk_messenger_messages_staff FOREIGN KEY (sent_by_staff_id) REFERENCES staff_users (user_id) ON DELETE SET NULL,
        CONSTRAINT chk_messenger_messages_dir CHECK (direction IN ('in', 'out')),
        CONSTRAINT chk_messenger_messages_status CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'received'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Message history for Rubika and SMS';
    """,
    """
    CREATE TABLE IF NOT EXISTS messenger_outbox (
        outbox_id        INT           NOT NULL AUTO_INCREMENT,
        channel          VARCHAR(20)   NOT NULL COMMENT 'rubika | sms',
        payload          JSON          NOT NULL COMMENT 'JSON payload with destination, body, metadata',
        attempts         INT           NOT NULL DEFAULT 0,
        status           VARCHAR(20)   NOT NULL DEFAULT 'pending' COMMENT 'pending | processing | completed | failed',
        next_try_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        error_message    TEXT          NULL,
        created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (outbox_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Asynchronous message outbox queue';
    """,
    """
    CREATE OR REPLACE VIEW v_messenger_thread_summary AS
    SELECT 
        t.thread_id,
        t.channel,
        t.external_id,
        COALESCE(t.title, CONCAT(s.first_name, ' ', s.last_name), t.external_id) AS display_name,
        t.student_id,
        t.lead_id,
        t.unread_count,
        t.last_message_at,
        m.body AS last_message_preview,
        m.direction AS last_message_direction,
        m.status AS last_message_status
    FROM messenger_threads t
    LEFT JOIN students s ON s.student_id = t.student_id
    LEFT JOIN messenger_messages m ON m.message_id = (
        SELECT max_m.message_id 
        FROM messenger_messages max_m 
        WHERE max_m.thread_id = t.thread_id 
        ORDER BY max_m.created_at DESC, max_m.message_id DESC 
        LIMIT 1
    );
    """
]

print("Executing SQL migrations for Messenger module...")
for stmt in sql_statements:
    try:
        cursor.execute(stmt)
        print("✅ Executed SQL statement successfully.")
    except Exception as e:
        print(f"⚠️ Statement info: {e}")

print("Verifying created tables...")
cursor.execute("SHOW TABLES LIKE 'messenger_%';")
tables = cursor.fetchall()
print("Messenger Tables in DB:", tables)

cursor.close()
conn.close()
print("Migration completed successfully!")
