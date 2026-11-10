CREATE INDEX loans_issued_at_idx ON loans (issued_at DESC, id DESC);
CREATE INDEX loans_report_snapshot_idx
  ON loans (reader_category_snapshot, class_name_snapshot, issued_at DESC, id DESC);
CREATE INDEX book_copies_lost_idx ON book_copies (id) WHERE is_lost = true;
CREATE INDEX book_copies_damaged_idx ON book_copies (id) WHERE condition = 'damaged';
CREATE INDEX reader_blocks_confirmed_at_idx
  ON reader_blocks (confirmed_at DESC, id DESC);
