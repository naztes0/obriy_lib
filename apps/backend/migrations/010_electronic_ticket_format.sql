DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM reader_personal_data
    WHERE ticket_type = 'electronic'
      AND ticket_number !~* '^E-[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'Electronic ticket numbers must contain an E- prefix and digits';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reader_personal_data
    WHERE ticket_type = 'electronic'
      AND substring(ticket_number FROM '(?i)^E-([0-9]+)$')::numeric > 999999
  ) THEN
    RAISE EXCEPTION 'Electronic ticket number exceeds the six-digit range';
  END IF;

  IF EXISTS (
    WITH formatted AS (
      SELECT 'E-' || lpad(
               substring(ticket_number FROM '(?i)^E-([0-9]+)$')::numeric::text,
               6,
               '0'
             ) AS ticket_number
      FROM reader_personal_data
      WHERE ticket_type = 'electronic'
    )
    SELECT 1
    FROM formatted
    GROUP BY upper(ticket_number)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Electronic ticket normalization would create a duplicate number';
  END IF;

  IF (SELECT last_value FROM electronic_ticket_number_seq) > 999999 THEN
    RAISE EXCEPTION 'Electronic ticket sequence exceeds the six-digit range';
  END IF;
END $$;

UPDATE reader_personal_data
SET ticket_number = 'E-' || lpad(
  substring(ticket_number FROM '(?i)^E-([0-9]+)$')::numeric::text,
  6,
  '0'
)
WHERE ticket_type = 'electronic';

ALTER TABLE reader_personal_data
  ADD CONSTRAINT reader_electronic_ticket_format_check CHECK (
    ticket_type <> 'electronic' OR ticket_number ~ '^E-[0-9]{6}$'
  );

ALTER SEQUENCE electronic_ticket_number_seq MAXVALUE 999999;
