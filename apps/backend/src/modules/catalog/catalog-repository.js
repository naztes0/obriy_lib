function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function mapBook(row) {
  return {
    id: String(row.id),
    title: row.title,
    authors: row.authors ?? [],
    publisher: row.publisher,
    publicationYear: row.publication_year,
    isbn: row.isbn,
    isTextbook: row.is_textbook,
    isArchived: row.archived_at !== null,
    version: String(row.version),
    totalCopies: Number(row.total_copies ?? 0),
    availableCopies: Number(row.available_copies ?? 0),
  };
}

function mapBookSummary(row) {
  return {
    id: String(row.id),
    title: row.title,
    authors: row.authors ?? [],
    publicationYear: row.publication_year,
    isbn: row.isbn,
    isArchived: row.archived_at !== null,
  };
}

async function saveAuthors(client, bookId, authors) {
  await client.query('DELETE FROM book_authors WHERE book_id = $1', [bookId]);

  for (const [index, name] of authors.entries()) {
    const authorResult = await client.query(
      `INSERT INTO authors (name)
       VALUES ($1)
       ON CONFLICT (name_normalized)
       DO UPDATE SET name = authors.name
       RETURNING id`,
      [name],
    );
    await client.query(
      `INSERT INTO book_authors (book_id, author_id, position)
       VALUES ($1, $2, $3)`,
      [bookId, authorResult.rows[0].id, index + 1],
    );
  }
}

function buildFilters(filters) {
  const conditions = [];
  const values = [];

  function addFragment(columnExpression, value) {
    if (!value) return;
    values.push(`%${escapeLike(value)}%`);
    conditions.push(`${columnExpression} ILIKE $${values.length} ESCAPE '\\'`);
  }

  addFragment('b.title', filters.title);
  addFragment('b.publisher', filters.publisher);

  if (filters.author) {
    values.push(`%${escapeLike(filters.author)}%`);
    conditions.push(`EXISTS (
      SELECT 1
      FROM book_authors search_ba
      JOIN authors search_a ON search_a.id = search_ba.author_id
      WHERE search_ba.book_id = b.id
        AND search_a.name ILIKE $${values.length} ESCAPE '\\'
    )`);
  }

  if (filters.archived === 'active') conditions.push('b.archived_at IS NULL');
  if (filters.archived === 'archived') conditions.push('b.archived_at IS NOT NULL');

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export class CatalogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listBooks({ filters, pageSize, offset }) {
    const { where, values } = buildFilters(filters);
    const countResult = await this.pool.query(`SELECT count(*) AS total FROM books b ${where}`, values);

    const limitPosition = values.length + 1;
    const offsetPosition = values.length + 2;
    const result = await this.pool.query(
      `SELECT b.id, b.title, b.publisher, b.publication_year, b.isbn,
              b.is_textbook, b.archived_at, b.version,
              COALESCE(author_data.authors, '[]'::jsonb) AS authors,
              COALESCE(copy_data.total_copies, 0) AS total_copies,
              COALESCE(copy_data.available_copies, 0) AS available_copies
       FROM books b
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
                  jsonb_build_object('id', a.id::text, 'name', a.name)
                  ORDER BY ba.position
                ) AS authors
         FROM book_authors ba
         JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = b.id
       ) author_data ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE bc.archived_at IS NULL) AS total_copies,
                count(*) FILTER (
                  WHERE b.archived_at IS NULL
                    AND bc.archived_at IS NULL
                    AND bc.is_lost = false
                    AND bc.is_temporarily_unavailable = false
                    AND bc.condition IN ('good', 'worn')
                    AND NOT EXISTS (
                      SELECT 1 FROM loans l
                      WHERE l.copy_id = bc.id AND l.status IN ('issued', 'lost')
                    )
                ) AS available_copies
         FROM book_copies bc
         WHERE bc.book_id = b.id
       ) copy_data ON true
       ${where}
       ORDER BY lower(b.title), b.id
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      [...values, pageSize, offset],
    );

    return {
      books: result.rows.map(mapBook),
      totalItems: Number(countResult.rows[0].total),
    };
  }

  async findBookByNormalizedIsbn(isbnNormalized, excludeBookId = null) {
    const result = await this.pool.query(
      `SELECT b.id, b.title, b.publication_year, b.isbn, b.archived_at,
              COALESCE(jsonb_agg(
                jsonb_build_object('id', a.id::text, 'name', a.name)
                ORDER BY ba.position
              ) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb) AS authors
       FROM books b
       LEFT JOIN book_authors ba ON ba.book_id = b.id
       LEFT JOIN authors a ON a.id = ba.author_id
       WHERE b.isbn_normalized = $1
         AND ($2::bigint IS NULL OR b.id <> $2)
       GROUP BY b.id
       LIMIT 1`,
      [isbnNormalized, excludeBookId],
    );
    return result.rowCount ? mapBookSummary(result.rows[0]) : null;
  }

  async findPossibleDuplicates({ titleNormalized, authorsNormalized, publicationYear, excludeBookId = null }) {
    const result = await this.pool.query(
      `SELECT b.id, b.title, b.publication_year, b.isbn, b.archived_at,
              COALESCE(jsonb_agg(
                jsonb_build_object('id', a.id::text, 'name', a.name)
                ORDER BY ba.position
              ) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb) AS authors
       FROM books b
       LEFT JOIN book_authors ba ON ba.book_id = b.id
       LEFT JOIN authors a ON a.id = ba.author_id
       WHERE b.isbn_normalized IS NULL
         AND lower(regexp_replace(btrim(b.title), '[[:space:]]+', ' ', 'g')) = $1
         AND b.publication_year IS NOT DISTINCT FROM $2::integer
         AND ($4::bigint IS NULL OR b.id <> $4)
       GROUP BY b.id
       HAVING COALESCE(
         array_agg(DISTINCT a.name_normalized ORDER BY a.name_normalized)
           FILTER (WHERE a.name_normalized IS NOT NULL),
         ARRAY[]::text[]
       ) = $3::text[]
       ORDER BY b.id`,
      [titleNormalized, publicationYear, authorsNormalized, excludeBookId],
    );
    return result.rows.map(mapBookSummary);
  }

  async createBook(book) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO books (title, publisher, publication_year, isbn, is_textbook)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [book.title, book.publisher, book.publicationYear, book.isbn, book.isTextbook],
      );
      const bookId = result.rows[0].id;
      await saveAuthors(client, bookId, book.authors);
      await client.query('COMMIT');
      return String(bookId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateBook(bookId, book) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE books
         SET title = $2,
             publisher = $3,
             publication_year = $4,
             isbn = $5,
             is_textbook = $6,
             version = version + 1
         WHERE id = $1 AND archived_at IS NULL
         RETURNING id`,
        [bookId, book.title, book.publisher, book.publicationYear, book.isbn, book.isTextbook],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await saveAuthors(client, bookId, book.authors);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findBookById(bookId) {
    const bookResult = await this.pool.query(
      `SELECT b.id, b.title, b.publisher, b.publication_year, b.isbn,
              b.is_textbook, b.archived_at, b.version,
              COALESCE(jsonb_agg(
                jsonb_build_object('id', a.id::text, 'name', a.name)
                ORDER BY ba.position
              ) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb) AS authors
       FROM books b
       LEFT JOIN book_authors ba ON ba.book_id = b.id
       LEFT JOIN authors a ON a.id = ba.author_id
       WHERE b.id = $1
       GROUP BY b.id`,
      [bookId],
    );
    if (!bookResult.rowCount) return null;

    const copiesResult = await this.pool.query(
      `SELECT bc.id, bc.inventory_number, bc.condition, bc.defect_description,
              bc.is_temporarily_unavailable, bc.is_lost, bc.archived_at, bc.version,
              ARRAY_REMOVE(ARRAY[
                CASE WHEN b.archived_at IS NOT NULL THEN 'book_archived' END,
                CASE WHEN bc.archived_at IS NOT NULL THEN 'copy_archived' END,
                CASE WHEN bc.is_lost THEN 'lost' END,
                CASE WHEN bc.is_temporarily_unavailable THEN 'temporarily_unavailable' END,
                CASE WHEN bc.condition = 'damaged' THEN 'damaged' END,
                CASE WHEN bc.condition = 'unrecorded' THEN 'condition_unrecorded' END,
                CASE WHEN EXISTS (
                  SELECT 1 FROM loans l
                  WHERE l.copy_id = bc.id AND l.status IN ('issued', 'lost')
                ) THEN 'on_loan' END
              ]::text[], NULL) AS availability_reasons
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       WHERE bc.book_id = $1
       ORDER BY lower(bc.inventory_number), bc.id`,
      [bookId],
    );

    const copies = copiesResult.rows.map((copy) => ({
      id: String(copy.id),
      inventoryNumber: copy.inventory_number,
      condition: copy.condition,
      defectDescription: copy.defect_description,
      isTemporarilyUnavailable: copy.is_temporarily_unavailable,
      isLost: copy.is_lost,
      isArchived: copy.archived_at !== null,
      isAvailable: copy.availability_reasons.length === 0,
      availabilityReasons: copy.availability_reasons,
      version: String(copy.version),
    }));

    return {
      ...mapBook({
        ...bookResult.rows[0],
        total_copies: copies.filter((copy) => !copy.isArchived).length,
        available_copies: copies.filter((copy) => copy.isAvailable).length,
      }),
      copies,
    };
  }
}
