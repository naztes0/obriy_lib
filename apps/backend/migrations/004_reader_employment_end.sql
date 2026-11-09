ALTER TABLE reader_personal_data
  ADD COLUMN employment_ended_on date;

ALTER TABLE reader_personal_data
  ADD CONSTRAINT reader_employment_end_category_check CHECK (
    category = 'employee' OR employment_ended_on IS NULL
  );

CREATE INDEX reader_personal_data_employment_end_idx
  ON reader_personal_data (employment_ended_on)
  WHERE category = 'employee' AND employment_ended_on IS NOT NULL;
