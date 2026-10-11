-- MKM v0.4: porodice, oslobađanja i zamrznuta mjesečna zaduženja.
ALTER TABLE members ADD COLUMN gender TEXT CHECK(gender IN ('boy','girl') OR gender IS NULL);
ALTER TABLE members ADD COLUMN family_id TEXT;
ALTER TABLE members ADD COLUMN fee_exempt INTEGER NOT NULL DEFAULT 0 CHECK(fee_exempt IN (0,1));
ALTER TABLE members ADD COLUMN fee_note TEXT NOT NULL DEFAULT '';
CREATE TABLE families (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_members_family ON members(family_id);
CREATE TABLE fee_charges (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id),
 month TEXT NOT NULL,
 cents INTEGER NOT NULL CHECK(cents>=0),
 reason TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(member_id,month)
);
CREATE INDEX idx_fee_charges_month ON fee_charges(month);
