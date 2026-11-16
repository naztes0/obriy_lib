-- A student may have no assigned class; historical loan snapshots stay unchanged.
ALTER TABLE reader_personal_data DROP CONSTRAINT IF EXISTS reader_personal_data_check;
ALTER TABLE reader_personal_data DROP CONSTRAINT IF EXISTS reader_category_details_check;
ALTER TABLE reader_personal_data ADD CONSTRAINT reader_category_details_check CHECK (
  (category = 'student' AND ticket_expires_on IS NOT NULL)
  OR (category = 'employee' AND class_id IS NULL AND ticket_expires_on IS NULL)
);
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_check4;
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loan_class_snapshot_check;
ALTER TABLE loans ADD CONSTRAINT loan_class_snapshot_check CHECK (
  reader_category_snapshot = 'student' OR class_name_snapshot IS NULL
);
