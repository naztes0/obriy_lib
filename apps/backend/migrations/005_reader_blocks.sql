CREATE TABLE reader_blocks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_id bigint NOT NULL REFERENCES readers(id),
  source_loan_id bigint REFERENCES loans(id) ON DELETE SET NULL,
  source_loan_reference bigint NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('overdue', 'unresolved_loss')),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by bigint NOT NULL REFERENCES staff_accounts(id),
  minimum_until date,
  is_indefinite boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by bigint REFERENCES staff_accounts(id),
  resolution_comment text,
  annulled_at timestamptz,
  annulled_by bigint REFERENCES staff_accounts(id),
  annul_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (source_loan_reference > 0),
  CHECK (
    (is_indefinite = true AND minimum_until IS NULL)
    OR (is_indefinite = false AND minimum_until IS NOT NULL)
  ),
  CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  ),
  CHECK (
    (annulled_at IS NULL AND annulled_by IS NULL AND annul_reason IS NULL)
    OR (
      annulled_at IS NOT NULL
      AND annulled_by IS NOT NULL
      AND nullif(btrim(annul_reason), '') IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX reader_blocks_one_active_per_reader
  ON reader_blocks (reader_id)
  WHERE resolved_at IS NULL AND annulled_at IS NULL;

CREATE UNIQUE INDEX reader_blocks_violation_unique
  ON reader_blocks (reader_id, source_loan_reference, reason_code)
  WHERE annulled_at IS NULL;

CREATE INDEX reader_blocks_reader_history_idx
  ON reader_blocks (reader_id, confirmed_at DESC, id DESC);

CREATE TABLE reader_unblock_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  block_id bigint NOT NULL REFERENCES reader_blocks(id),
  requested_by bigint NOT NULL REFERENCES staff_accounts(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  request_comment text,
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'approved', 'rejected')),
  decided_by bigint REFERENCES staff_accounts(id),
  decided_at timestamptz,
  decision_comment text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (decision = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (decision <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX reader_unblock_requests_one_pending_per_block
  ON reader_unblock_requests (block_id)
  WHERE decision = 'pending';

CREATE INDEX reader_unblock_requests_block_history_idx
  ON reader_unblock_requests (block_id, requested_at DESC, id DESC);
