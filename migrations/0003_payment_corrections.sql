-- Immutable history of changes to payment data. Never delete historical records.
CREATE TABLE payment_corrections (
 id TEXT PRIMARY KEY,
 payment_id TEXT NOT NULL REFERENCES payments(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 500),
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 corrected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_payment_corrections_payment ON payment_corrections(payment_id, corrected_at);
