PRAGMA foreign_keys=ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','coach')),
 password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, iterations INTEGER NOT NULL DEFAULT 20000,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE groups (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, coach_name TEXT NOT NULL DEFAULT '',
 schedule_days TEXT NOT NULL DEFAULT '', schedule_time TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE coach_groups (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,group_id)
);
CREATE TABLE members (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, birth_date TEXT NOT NULL DEFAULT '',
 group_id TEXT NOT NULL REFERENCES groups(id), parent_name TEXT NOT NULL DEFAULT '',
 parent_phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_members_group ON members(group_id);
CREATE TABLE payments (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 month TEXT NOT NULL, paid_at TEXT NOT NULL, cents INTEGER NOT NULL CHECK(cents>0),
 method TEXT NOT NULL CHECK(method IN ('cash','bank','other')),
 recorded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_payments_member_month ON payments(member_id,month);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id),
 held_on TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE attendance (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id),
 status TEXT NOT NULL CHECK(status IN ('present','absent','excused','late')),
 PRIMARY KEY(session_id,member_id)
);
CREATE TABLE auth_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE login_attempts (email TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO settings (key,value) VALUES ('monthly_fee_cents','3000');
CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
