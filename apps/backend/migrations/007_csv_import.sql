CREATE TABLE import_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_name varchar(128) NOT NULL CHECK (btrim(source_name) <> ''),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  operator_name text NOT NULL CHECK (btrim(operator_name) <> ''),
  record_counts jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_name, content_hash)
);

CREATE TABLE import_record_links (
  source_name varchar(128) NOT NULL,
  batch_id bigint NOT NULL REFERENCES import_batches(id),
  entity_kind varchar(32) NOT NULL CHECK (entity_kind IN (
    'book', 'copy', 'reader', 'loan', 'loan_event', 'loan_extension',
    'copy_event', 'reader_block', 'unblock_request'
  )),
  source_key text NOT NULL CHECK (btrim(source_key) <> ''),
  target_id bigint NOT NULL CHECK (target_id > 0),
  PRIMARY KEY (source_name, entity_kind, source_key)
);

CREATE INDEX import_record_links_batch_idx ON import_record_links (batch_id);

ALTER TABLE loans
  ADD COLUMN performed_by_snapshot text;

ALTER TABLE loan_status_events
  ADD COLUMN import_source_key text,
  ADD COLUMN performed_by_snapshot text;

ALTER TABLE loan_extensions
  ADD COLUMN import_source_key text,
  ADD COLUMN performed_by_snapshot text;

ALTER TABLE book_copy_events
  ADD COLUMN import_source_key text,
  ADD COLUMN performed_by_snapshot text;

ALTER TABLE reader_blocks
  ALTER COLUMN confirmed_by DROP NOT NULL,
  ADD COLUMN import_source_key text,
  ADD COLUMN confirmed_by_snapshot text,
  ADD COLUMN resolved_by_snapshot text,
  ADD COLUMN annulled_by_snapshot text;

ALTER TABLE reader_unblock_requests
  ALTER COLUMN requested_by DROP NOT NULL,
  ADD COLUMN import_source_key text,
  ADD COLUMN requested_by_snapshot text,
  ADD COLUMN decided_by_snapshot text;

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'reader_blocks'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) LIKE '%resolved_at IS NULL%'
        OR pg_get_constraintdef(oid) LIKE '%annulled_at IS NULL%'
      )
  LOOP
    EXECUTE format('ALTER TABLE reader_blocks DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'reader_unblock_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%decision%pending%'
  LOOP
    EXECUTE format(
      'ALTER TABLE reader_unblock_requests DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END $$;

ALTER TABLE reader_blocks
  ADD CONSTRAINT reader_blocks_confirmed_actor_check CHECK (
    confirmed_by IS NOT NULL OR nullif(btrim(confirmed_by_snapshot), '') IS NOT NULL
  ),
  ADD CONSTRAINT reader_blocks_resolution_actor_check CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolved_by_snapshot IS NULL)
    OR (
      resolved_at IS NOT NULL
      AND (resolved_by IS NOT NULL OR nullif(btrim(resolved_by_snapshot), '') IS NOT NULL)
    )
  ),
  ADD CONSTRAINT reader_blocks_annulment_actor_check CHECK (
    (annulled_at IS NULL AND annulled_by IS NULL AND annulled_by_snapshot IS NULL AND annul_reason IS NULL)
    OR (
      annulled_at IS NOT NULL
      AND (annulled_by IS NOT NULL OR nullif(btrim(annulled_by_snapshot), '') IS NOT NULL)
      AND nullif(btrim(annul_reason), '') IS NOT NULL
    )
  );

ALTER TABLE reader_unblock_requests
  ADD CONSTRAINT reader_unblock_requests_requested_actor_check CHECK (
    requested_by IS NOT NULL OR nullif(btrim(requested_by_snapshot), '') IS NOT NULL
  ),
  ADD CONSTRAINT reader_unblock_requests_decision_actor_check CHECK (
    (
      decision = 'pending'
      AND decided_by IS NULL
      AND decided_by_snapshot IS NULL
      AND decided_at IS NULL
    )
    OR (
      decision <> 'pending'
      AND (decided_by IS NOT NULL OR nullif(btrim(decided_by_snapshot), '') IS NOT NULL)
      AND decided_at IS NOT NULL
    )
  );
