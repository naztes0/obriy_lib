ALTER TABLE authors
  ADD COLUMN name_normalized text GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  ) STORED;

CREATE UNIQUE INDEX authors_name_normalized_unique
  ON authors (name_normalized);
