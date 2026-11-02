CREATE TABLE staff_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login varchar(64) NOT NULL,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('librarian', 'manager')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_accounts_login_not_blank CHECK (btrim(login) <> '')
);
CREATE UNIQUE INDEX staff_accounts_login_unique ON staff_accounts (lower(login));

CREATE TABLE school_classes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(64) NOT NULL CHECK (btrim(name) <> ''),
  is_active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX school_classes_name_unique ON school_classes (lower(name));

CREATE TABLE authors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> '')
);

CREATE TABLE books (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (btrim(title) <> ''),
  publisher text NOT NULL CHECK (btrim(publisher) <> ''),
  publication_year integer CHECK (publication_year BETWEEN 1 AND 9999),
  isbn varchar(32),
  isbn_normalized text GENERATED ALWAYS AS (
    nullif(upper(regexp_replace(isbn, '[-[:space:]]', '', 'g')), '')
  ) STORED,
  is_textbook boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX books_isbn_unique ON books (isbn_normalized) WHERE isbn_normalized IS NOT NULL;
CREATE INDEX books_title_search ON books (lower(title));
CREATE INDEX books_publisher_search ON books (lower(publisher));

CREATE TABLE book_authors (
  book_id bigint NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  author_id bigint NOT NULL REFERENCES authors(id),
  position integer NOT NULL CHECK (position > 0),
  PRIMARY KEY (book_id, author_id),
  UNIQUE (book_id, position)
);
CREATE INDEX book_authors_author_id_idx ON book_authors (author_id);

CREATE TABLE readers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  personal_data_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (personal_data_deleted_at IS NULL OR personal_data_deleted_at >= created_at)
);

CREATE TABLE reader_personal_data (
  reader_id bigint PRIMARY KEY REFERENCES readers(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  category text NOT NULL CHECK (category IN ('student', 'employee')),
  class_id bigint REFERENCES school_classes(id),
  phone varchar(13) NOT NULL CHECK (phone ~ '^\+380[0-9]{9}$'),
  address text,
  ticket_number varchar(32) NOT NULL CHECK (
    ticket_number ~ '^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9/-]{1,32}$'
  ),
  ticket_type text NOT NULL CHECK (ticket_type IN ('existing', 'electronic')),
  ticket_issued_on date,
  ticket_expires_on date,
  archived_at timestamptz,
  archive_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (category = 'student' AND class_id IS NOT NULL AND ticket_expires_on IS NOT NULL)
    OR (category = 'employee' AND class_id IS NULL AND ticket_expires_on IS NULL)
  ),
  CHECK (ticket_type <> 'electronic' OR (category = 'student' AND ticket_issued_on IS NOT NULL)),
  CHECK (archived_at IS NULL OR nullif(btrim(archive_reason), '') IS NOT NULL)
);
CREATE UNIQUE INDEX reader_ticket_number_unique ON reader_personal_data (upper(ticket_number));
CREATE INDEX reader_personal_data_name_idx ON reader_personal_data (lower(full_name));
CREATE INDEX reader_personal_data_class_idx ON reader_personal_data (class_id);
CREATE INDEX reader_personal_data_expiry_idx ON reader_personal_data (ticket_expires_on)
  WHERE category = 'student';
CREATE SEQUENCE electronic_ticket_number_seq AS bigint START WITH 1;

CREATE TABLE reader_personal_data_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_id bigint NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  actor_id bigint REFERENCES staff_accounts(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reader_personal_data_changes_reader_idx
  ON reader_personal_data_changes (reader_id, occurred_at DESC, id DESC);

CREATE TABLE reader_record_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_id bigint NOT NULL REFERENCES readers(id),
  event_type text NOT NULL CHECK (event_type IN ('archived', 'restored', 'anonymized')),
  actor_id bigint REFERENCES staff_accounts(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
CREATE INDEX reader_record_events_reader_idx
  ON reader_record_events (reader_id, occurred_at DESC, id DESC);

CREATE TABLE book_copies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id bigint NOT NULL REFERENCES books(id),
  inventory_number varchar(32) NOT NULL CHECK (
    inventory_number ~ '^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9/-]{1,32}$'
  ),
  condition text NOT NULL CHECK (condition IN ('good', 'worn', 'damaged', 'unrecorded')),
  defect_description text,
  is_temporarily_unavailable boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (condition NOT IN ('worn', 'damaged') OR nullif(btrim(defect_description), '') IS NOT NULL)
);
CREATE UNIQUE INDEX book_copies_inventory_unique ON book_copies (upper(inventory_number));
CREATE INDEX book_copies_book_idx ON book_copies (book_id);

CREATE TABLE textbook_issue_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_name_snapshot varchar(64) NOT NULL,
  actor_id bigint NOT NULL REFERENCES staff_accounts(id),
  request_key varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, request_key)
);

CREATE TABLE loans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_id bigint NOT NULL REFERENCES readers(id),
  copy_id bigint NOT NULL REFERENCES book_copies(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by bigint REFERENCES staff_accounts(id),
  initial_due_date date NOT NULL,
  current_due_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('issued', 'lost', 'returned', 'compensated')),
  returned_at timestamptz,
  compensated_at timestamptz,
  issue_condition text NOT NULL CHECK (issue_condition IN ('good', 'worn', 'unrecorded')),
  issue_defect_snapshot text,
  return_condition text CHECK (return_condition IN ('good', 'worn', 'damaged', 'unrecorded')),
  return_defect_snapshot text,
  reader_category_snapshot text NOT NULL CHECK (reader_category_snapshot IN ('student', 'employee')),
  class_name_snapshot varchar(64),
  batch_id bigint REFERENCES textbook_issue_batches(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  import_source_key text,
  CHECK (initial_due_date <= current_due_date),
  CHECK (returned_at IS NULL OR returned_at >= issued_at),
  CHECK (compensated_at IS NULL OR compensated_at >= issued_at),
  CHECK (
    (status IN ('issued', 'lost') AND returned_at IS NULL AND compensated_at IS NULL)
    OR (status = 'returned' AND returned_at IS NOT NULL AND compensated_at IS NULL)
    OR (status = 'compensated' AND returned_at IS NULL AND compensated_at IS NOT NULL)
  ),
  CHECK (
    (reader_category_snapshot = 'student' AND class_name_snapshot IS NOT NULL)
    OR (reader_category_snapshot = 'employee' AND class_name_snapshot IS NULL)
  )
);
CREATE UNIQUE INDEX loans_one_open_per_copy ON loans (copy_id)
  WHERE status IN ('issued', 'lost');
CREATE INDEX loans_reader_history_idx ON loans (reader_id, issued_at DESC, id DESC);
CREATE INDEX loans_copy_history_idx ON loans (copy_id, issued_at DESC, id DESC);
CREATE INDEX loans_due_date_idx ON loans (current_due_date) WHERE status = 'issued';
CREATE INDEX loans_batch_idx ON loans (batch_id);

CREATE TABLE loan_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id bigint NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  from_status text CHECK (from_status IN ('issued', 'lost', 'returned', 'compensated')),
  to_status text NOT NULL CHECK (to_status IN ('issued', 'lost', 'returned', 'compensated')),
  actor_id bigint REFERENCES staff_accounts(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  request_key varchar(128),
  CHECK (from_status IS NULL OR from_status <> to_status)
);
CREATE INDEX loan_status_events_loan_idx
  ON loan_status_events (loan_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX loan_status_events_request_unique
  ON loan_status_events (loan_id, request_key) WHERE request_key IS NOT NULL;

CREATE TABLE loan_extensions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id bigint NOT NULL UNIQUE REFERENCES loans(id) ON DELETE CASCADE,
  old_due_date date NOT NULL,
  new_due_date date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  actor_id bigint REFERENCES staff_accounts(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_key varchar(128),
  CHECK (new_due_date > old_due_date AND new_due_date <= old_due_date + 30)
);

CREATE TABLE book_copy_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  copy_id bigint NOT NULL REFERENCES book_copies(id) ON DELETE CASCADE,
  kind text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  actor_id bigint REFERENCES staff_accounts(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  loan_id bigint REFERENCES loans(id) ON DELETE CASCADE,
  related_loan_status_event_id bigint REFERENCES loan_status_events(id) ON DELETE SET NULL,
  request_key varchar(128)
);
CREATE INDEX book_copy_events_copy_idx
  ON book_copy_events (copy_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX book_copy_events_request_unique
  ON book_copy_events (copy_id, request_key) WHERE request_key IS NOT NULL;

CREATE TABLE processed_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id bigint NOT NULL REFERENCES staff_accounts(id),
  operation text NOT NULL,
  request_key varchar(128) NOT NULL,
  result_entity_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, operation, request_key)
);
