CREATE TABLE book_record_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id bigint NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('archived', 'restored')),
  actor_id bigint REFERENCES staff_accounts(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  request_key varchar(128)
);

CREATE INDEX book_record_events_book_idx
  ON book_record_events (book_id, occurred_at DESC, id DESC);

CREATE UNIQUE INDEX book_record_events_request_unique
  ON book_record_events (book_id, request_key)
  WHERE request_key IS NOT NULL;
