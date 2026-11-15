CREATE TABLE IF NOT EXISTS operation_corrections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id bigint NOT NULL REFERENCES staff_accounts(id),
  operation text NOT NULL,
  entity_id bigint NOT NULL,
  request_key varchar(128) NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  result jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, operation, request_key)
);
CREATE INDEX IF NOT EXISTS operation_corrections_entity_idx ON operation_corrections(operation, entity_id, occurred_at DESC);
