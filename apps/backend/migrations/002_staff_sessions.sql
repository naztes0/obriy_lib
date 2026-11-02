CREATE TABLE staff_sessions (
  id uuid PRIMARY KEY,
  staff_id bigint NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX staff_sessions_active_token_idx
  ON staff_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX staff_sessions_staff_idx
  ON staff_sessions (staff_id, created_at DESC);
