CREATE TABLE announcements (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('public','users')),
 group_id TEXT REFERENCES groups(id), author_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX announcements_date ON announcements(created_at);
CREATE TABLE push_config (id INTEGER PRIMARY KEY CHECK(id=1), public_key TEXT NOT NULL, private_key TEXT NOT NULL);
CREATE TABLE push_subscriptions (
 id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
 owner_hash TEXT NOT NULL, user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE push_deliveries (
 id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL REFERENCES announcements(id),
 subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 UNIQUE(announcement_id,subscription_id)
);
CREATE INDEX push_delivery_queue ON push_deliveries(status,next_attempt);
CREATE TABLE push_rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
