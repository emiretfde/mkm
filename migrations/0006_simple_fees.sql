-- New fee policy; historical charges and payments remain untouched.
CREATE TABLE member_fee_changes (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id),
 effective_month TEXT NOT NULL,
 cents INTEGER NOT NULL CHECK(cents IN (3000,4000)),
 before_cents INTEGER NOT NULL CHECK(before_cents IN (3000,4000)),
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX member_fee_changes_month ON member_fee_changes(member_id,effective_month);
