INSERT INTO book_copy_events(copy_id,kind,old_value,new_value,reason,actor_id,loan_id,occurred_at,performed_by_snapshot)
SELECT l.copy_id,'extended',json_build_object('currentDueDate',le.old_due_date)::text,
  json_build_object('currentDueDate',le.new_due_date)::text,le.reason,le.actor_id,l.id,le.occurred_at,le.performed_by_snapshot
FROM loan_extensions le JOIN loans l ON l.id=le.loan_id
WHERE NOT EXISTS (SELECT 1 FROM book_copy_events e WHERE e.loan_id=l.id AND e.kind='extended');
