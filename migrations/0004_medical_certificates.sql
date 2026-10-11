-- Date-only register: no scans, health details or file storage.
CREATE TABLE medical_certificates (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id),
 issued_on TEXT NOT NULL,
 expires_on TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id),
 recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 archived_at TEXT
);
CREATE INDEX idx_medical_certificates_member ON medical_certificates(member_id, recorded_at DESC);
CREATE UNIQUE INDEX idx_medical_certificates_current ON medical_certificates(member_id) WHERE archived_at IS NULL;
