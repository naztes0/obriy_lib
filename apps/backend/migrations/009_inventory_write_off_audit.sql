CREATE TABLE inventory_write_off_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  former_copy_id bigint NOT NULL CHECK (former_copy_id > 0),
  former_inventory_number varchar(32) NOT NULL,
  reason text NOT NULL CHECK (nullif(btrim(reason), '') IS NOT NULL),
  actor_id bigint NOT NULL REFERENCES staff_accounts(id),
  deleted_loan_count integer NOT NULL CHECK (deleted_loan_count >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_key varchar(128) NOT NULL,
  UNIQUE (actor_id, request_key)
);

CREATE INDEX inventory_write_off_audit_copy_idx
  ON inventory_write_off_audit (former_copy_id, occurred_at DESC);
