const REPORT_TYPES = [
  'fund',
  'current-loans',
  'overdue-loans',
  'unresolved-losses',
  'blocks',
  'damaged-copies',
  'reader-activity',
];

const pathParameter = (name) => ({
  name,
  in: 'path',
  required: true,
  schema: name === 'reportType'
    ? { type: 'string', enum: REPORT_TYPES }
    : { type: 'string', pattern: '^[1-9][0-9]*$' },
});

const queryParameter = (name, description, schema = { type: 'string' }) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});

const idempotencyParameter = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: 'Унікальний ключ повторюваної команди. Повтор із тим самим ключем не дублює операцію.',
  schema: { type: 'string', minLength: 1, maxLength: 128 },
};

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const errorResponse = (description, code, message, details) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
      example: {
        error: {
          code,
          message,
          requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          ...(details ? { details } : {}),
        },
      },
    },
  },
});

function operation({
  operationId,
  tag,
  summary,
  method,
  path,
  body,
  idempotency = false,
  roles = [],
  security = true,
  query = [],
  successStatus,
  successDescription = 'Операцію виконано успішно.',
  responseContent = true,
  responseMediaType = 'application/json',
  errors = method === 'get' ? ['400'] : ['400', '409', '422'],
}) {
  const pathNames = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const parameters = [
    ...pathNames.map(pathParameter),
    ...query,
    ...(idempotency ? [idempotencyParameter] : []),
  ];
  const status = String(successStatus ?? (method === 'post' ? 201 : 200));
  const roleDescription = roles.length
    ? `Доступно лише для ролей: ${roles.map((role) => role === 'manager' ? 'завідувач' : 'бібліотекар').join(', ')}.`
    : undefined;
  const errorResponses = {
    400: 'ValidationError',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'NotFound',
    409: 'Conflict',
    422: 'BusinessRuleError',
    500: 'InternalError',
    503: 'ServiceUnavailable',
  };
  const documentedErrors = new Set([
    ...errors,
    ...(security ? ['401'] : []),
    ...(roles.length ? ['403'] : []),
    ...(pathNames.length ? ['404'] : []),
    '500',
  ]);
  const result = {
    operationId,
    tags: [tag],
    summary,
    ...(roleDescription ? { description: roleDescription } : {}),
    ...(security ? { security: [{ cookieAuth: [] }] } : { security: [] }),
    ...(parameters.length ? { parameters } : {}),
    ...(body ? { requestBody: jsonBody(body) } : {}),
    responses: {
      [status]: {
        description: successDescription,
        ...(responseContent ? {
          content: {
            [responseMediaType]: {
              schema: responseMediaType === 'application/pdf'
                ? { type: 'string', format: 'binary' }
                : { $ref: '#/components/schemas/SuccessResponse' },
            },
          },
        } : {}),
      },
      ...Object.fromEntries(
        [...documentedErrors].map((code) => [
          code,
          { $ref: `#/components/responses/${errorResponses[code]}` },
        ]),
      ),
    },
  };
  return result;
}

const operations = [
  { method: 'get', path: '/health', operationId: 'getHealth', tag: 'System', summary: 'Перевірити сервер і підключення до БД', security: false, errors: ['503'] },
  { method: 'post', path: '/api/v1/auth/login', operationId: 'login', tag: 'Auth', summary: 'Увійти до системи', security: false, body: { $ref: '#/components/schemas/LoginRequest' }, successStatus: 200, errors: ['400', '401'] },
  { method: 'get', path: '/api/v1/auth/session', operationId: 'getSession', tag: 'Auth', summary: 'Отримати поточну сесію' },
  { method: 'post', path: '/api/v1/auth/logout', operationId: 'logout', tag: 'Auth', summary: 'Завершити поточну сесію', successStatus: 200 },

  { method: 'get', path: '/api/v1/staff', operationId: 'listStaff', tag: 'Staff', summary: 'Отримати працівників', roles: ['manager'], query: [queryParameter('activity', 'active, inactive або all', { type: 'string', enum: ['active', 'inactive', 'all'] }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'post', path: '/api/v1/staff', operationId: 'createLibrarian', tag: 'Staff', summary: 'Створити бібліотекаря', roles: ['manager'], body: { $ref: '#/components/schemas/LibrarianCreate' } },
  { method: 'patch', path: '/api/v1/staff/me', operationId: 'updateManagerProfile', tag: 'Staff', summary: 'Змінити ім’я завідувача', roles: ['manager'], body: { $ref: '#/components/schemas/ManagerProfile' } },
  { method: 'patch', path: '/api/v1/staff/me/password', operationId: 'changeManagerPassword', tag: 'Staff', summary: 'Змінити власний пароль завідувача', roles: ['manager'], body: { $ref: '#/components/schemas/ManagerPasswordChange' } },
  { method: 'patch', path: '/api/v1/staff/{staffId}/activity', operationId: 'setLibrarianActivity', tag: 'Staff', summary: 'Активувати або деактивувати бібліотекаря', roles: ['manager'], body: { $ref: '#/components/schemas/StaffActivity' } },
  { method: 'patch', path: '/api/v1/staff/{staffId}/password', operationId: 'changeLibrarianPassword', tag: 'Staff', summary: 'Змінити пароль бібліотекаря', roles: ['manager'], body: { $ref: '#/components/schemas/LibrarianPasswordChange' } },

  { method: 'get', path: '/api/v1/school-classes', operationId: 'listClasses', tag: 'Classes', summary: 'Отримати класи', query: [queryParameter('status', 'active, inactive або all')] },
  { method: 'post', path: '/api/v1/school-classes', operationId: 'createClass', tag: 'Classes', summary: 'Створити клас', roles: ['manager'], body: { $ref: '#/components/schemas/ClassCreate' } },
  { method: 'patch', path: '/api/v1/school-classes/{classId}', operationId: 'renameClass', tag: 'Classes', summary: 'Перейменувати клас', roles: ['manager'], body: { $ref: '#/components/schemas/ClassCreate' } },
  { method: 'patch', path: '/api/v1/school-classes/{classId}/activity', operationId: 'setClassActivity', tag: 'Classes', summary: 'Змінити активність класу', roles: ['manager'], body: { $ref: '#/components/schemas/ClassActivity' } },
  { method: 'post', path: '/api/v1/school-classes/{classId}/delete', operationId: 'deleteClass', tag: 'Classes', summary: 'Видалити клас без пов’язаних записів', roles: ['manager'], body: { $ref: '#/components/schemas/Confirmation' }, successStatus: 200 },

  { method: 'get', path: '/api/v1/books', operationId: 'listBooks', tag: 'Books', summary: 'Знайти видання', query: [queryParameter('title', 'Фрагмент назви'), queryParameter('author', 'Фрагмент автора'), queryParameter('publisher', 'Фрагмент видавництва'), queryParameter('archived', 'active, archived або all', { type: 'string', enum: ['active', 'archived', 'all'] }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'get', path: '/api/v1/books/{bookId}', operationId: 'getBook', tag: 'Books', summary: 'Отримати картку видання' },
  { method: 'post', path: '/api/v1/books', operationId: 'createBook', tag: 'Books', summary: 'Створити видання', body: { $ref: '#/components/schemas/BookCreate' } },
  { method: 'patch', path: '/api/v1/books/{bookId}', operationId: 'updateBook', tag: 'Books', summary: 'Відредагувати видання', body: { $ref: '#/components/schemas/BookUpdate' } },
  { method: 'post', path: '/api/v1/books/{bookId}/archive', operationId: 'archiveBook', tag: 'Books', summary: 'Архівувати видання', body: { $ref: '#/components/schemas/BookArchive' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/books/{bookId}/restore', operationId: 'restoreBook', tag: 'Books', summary: 'Відновити видання', body: { $ref: '#/components/schemas/BookRestore' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/books/{bookId}/delete', operationId: 'deleteBook', tag: 'Books', summary: 'Видалити невикористане видання', body: { $ref: '#/components/schemas/BookDelete' }, idempotency: true, roles: ['manager', 'librarian'], successStatus: 200 },

  { method: 'post', path: '/api/v1/books/{bookId}/copies', operationId: 'createCopy', tag: 'Copies', summary: 'Додати фізичний примірник', body: { $ref: '#/components/schemas/CopyCreate' } },
  { method: 'patch', path: '/api/v1/copies/{copyId}/condition', operationId: 'changeCopyCondition', tag: 'Copies', summary: 'Змінити фізичний стан примірника', body: { $ref: '#/components/schemas/CopyConditionChange' } },
  { method: 'patch', path: '/api/v1/copies/{copyId}/temporary-unavailability', operationId: 'setCopyUnavailable', tag: 'Copies', summary: 'Змінити тимчасову недоступність', body: { $ref: '#/components/schemas/CopyTemporaryUnavailability' } },
  { method: 'post', path: '/api/v1/copies/{copyId}/loss', operationId: 'markCopyLostInFund', tag: 'Copies', summary: 'Зафіксувати втрату примірника у фонді', body: { $ref: '#/components/schemas/VersionReason' }, idempotency: true, successStatus: 200 },
  { method: 'get', path: '/api/v1/copies/{copyId}/history', operationId: 'getCopyHistory', tag: 'Copies', summary: 'Отримати історію примірника' },
  { method: 'post', path: '/api/v1/copies/{copyId}/archive', operationId: 'archiveCopy', tag: 'Copies', summary: 'Архівувати примірник', body: { $ref: '#/components/schemas/CopyArchive' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{copyId}/restore', operationId: 'restoreCopy', tag: 'Copies', summary: 'Відновити примірник', body: { $ref: '#/components/schemas/CopyRestore' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{copyId}/delete', operationId: 'deleteCopy', tag: 'Copies', summary: 'Видалити примірник без історії', body: { $ref: '#/components/schemas/CopyDelete' }, idempotency: true, roles: ['manager', 'librarian'], successStatus: 200 },
  { method: 'patch', path: '/api/v1/copies/{copyId}/inventory-number', operationId: 'correctInventoryNumber', tag: 'Copies', summary: 'Виправити інвентарний номер', body: { $ref: '#/components/schemas/InventoryNumberCorrection' }, idempotency: true, roles: ['manager'] },
  { method: 'post', path: '/api/v1/copies/{copyId}/write-off', operationId: 'writeOffCopy', tag: 'Copies', summary: 'Остаточно списати примірник', body: { $ref: '#/components/schemas/CopyWriteOff' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'patch', path: '/api/v1/copies/{copyId}/book', operationId: 'changeCopyBook', tag: 'Copies', summary: 'Змінити прив’язку примірника до видання', body: { $ref: '#/components/schemas/CopyBookChange' }, idempotency: true },
  { method: 'post', path: '/api/v1/copies/{id}/correct-loss', operationId: 'correctFundLoss', tag: 'Copies', summary: 'Скасувати помилкову втрату примірника у фонді', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{id}/settle-loss', operationId: 'settleFundLoss', tag: 'Copies', summary: 'Врегулювати втрату примірника у фонді', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, roles: ['manager'], successStatus: 200 },

  { method: 'get', path: '/api/v1/readers', operationId: 'listReaders', tag: 'Readers', summary: 'Знайти читачів', query: [queryParameter('q', 'ПІБ або номер квитка'), queryParameter('archived', 'active, archived або all', { type: 'string', enum: ['active', 'archived', 'all'] }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'get', path: '/api/v1/readers/{readerId}', operationId: 'getReader', tag: 'Readers', summary: 'Отримати картку читача' },
  { method: 'get', path: '/api/v1/readers/{readerId}/ticket.pdf', operationId: 'downloadTicket', tag: 'Readers', summary: 'Завантажити електронний квиток', responseMediaType: 'application/pdf' },
  { method: 'post', path: '/api/v1/readers', operationId: 'createReader', tag: 'Readers', summary: 'Створити читача', body: { $ref: '#/components/schemas/ReaderCreate' } },
  { method: 'patch', path: '/api/v1/readers/{readerId}', operationId: 'updateReader', tag: 'Readers', summary: 'Відредагувати читача', body: { $ref: '#/components/schemas/ReaderUpdate' } },
  { method: 'post', path: '/api/v1/readers/{readerId}/archive', operationId: 'archiveReader', tag: 'Readers', summary: 'Архівувати читача', body: { $ref: '#/components/schemas/VersionReason' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/readers/{readerId}/restore', operationId: 'restoreReader', tag: 'Readers', summary: 'Відновити читача', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'patch', path: '/api/v1/readers/{readerId}/employment-end', operationId: 'setEmploymentEnd', tag: 'Readers', summary: 'Змінити дату звільнення працівника', body: { $ref: '#/components/schemas/EmploymentEnd' } },
  { method: 'get', path: '/api/v1/readers/{readerId}/history', operationId: 'getReaderHistory', tag: 'Readers', summary: 'Отримати розширену історію читача', query: [queryParameter('dateFrom', 'Початок періоду', { type: 'string', format: 'date' }), queryParameter('dateTo', 'Кінець періоду', { type: 'string', format: 'date' }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },

  { method: 'get', path: '/api/v1/loans/{loanId}', operationId: 'getLoan', tag: 'Loans', summary: 'Отримати видачу' },
  { method: 'post', path: '/api/v1/loans', operationId: 'issueLoan', tag: 'Loans', summary: 'Видати примірник', body: { $ref: '#/components/schemas/LoanIssue' }, idempotency: true },
  { method: 'post', path: '/api/v1/loans/{loanId}/return', operationId: 'returnLoan', tag: 'Loans', summary: 'Повернути примірник', body: { $ref: '#/components/schemas/LoanReturn' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/extend', operationId: 'extendLoan', tag: 'Loans', summary: 'Продовжити строк видачі', body: { $ref: '#/components/schemas/LoanExtension' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/loss', operationId: 'markLoanLost', tag: 'Loans', summary: 'Зафіксувати втрату на руках', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/compensate', operationId: 'compensateLoan', tag: 'Loans', summary: 'Підтвердити компенсацію втрати', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{copyId}/found', operationId: 'markCopyFound', tag: 'Loans', summary: 'Повернути знайдений примірник до фонду', body: { $ref: '#/components/schemas/VersionReason' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/correct-status', operationId: 'correctLoanStatus', tag: 'Loans', summary: 'Виправити помилковий статус видачі', body: { $ref: '#/components/schemas/LoanStatusCorrection' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/erroneous-return', operationId: 'recordErroneousReturn', tag: 'Loans', summary: 'Зафіксувати помилкове повернення', body: { $ref: '#/components/schemas/ErroneousReturn' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'get', path: '/api/v1/loans/{loanId}/audit', operationId: 'getLoanAudit', tag: 'Loans', summary: 'Отримати аудит виправлень видачі' },
  { method: 'post', path: '/api/v1/loans/{id}/correct-participants', operationId: 'correctLoanParticipants', tag: 'Loans', summary: 'Виправити читача або примірник у видачі', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{id}/void', operationId: 'voidLoan', tag: 'Loans', summary: 'Вилучити помилкову видачу без фактичної передачі', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, roles: ['manager'], successStatus: 200 },

  { method: 'get', path: '/api/v1/restrictions', operationId: 'listRestrictions', tag: 'Restrictions', summary: 'Отримати активні блокування', query: [queryParameter('pending', 'Лише блокування із запитом на розгляд', { type: 'boolean' }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'get', path: '/api/v1/readers/{readerId}/blocks', operationId: 'listReaderBlocks', tag: 'Restrictions', summary: 'Отримати історію блокувань' },
  { method: 'post', path: '/api/v1/readers/{readerId}/blocks', operationId: 'confirmReaderBlock', tag: 'Restrictions', summary: 'Підтвердити блокування читача', body: { $ref: '#/components/schemas/BlockCreate' }, idempotency: true, roles: ['manager'] },
  { method: 'post', path: '/api/v1/reader-blocks/{blockId}/unblock-requests', operationId: 'requestUnblock', tag: 'Restrictions', summary: 'Подати запит на розблокування', body: { $ref: '#/components/schemas/UnblockRequest' }, idempotency: true, roles: ['librarian'] },
  { method: 'post', path: '/api/v1/reader-blocks/{blockId}/unblock', operationId: 'unblockReader', tag: 'Restrictions', summary: 'Розблокувати читача', body: { $ref: '#/components/schemas/UnblockCommand' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/reader-unblock-requests/{requestId}/decision', operationId: 'decideUnblock', tag: 'Restrictions', summary: 'Розглянути запит на розблокування', body: { $ref: '#/components/schemas/UnblockDecision' }, idempotency: true, roles: ['manager'], successStatus: 200 },
  { method: 'post', path: '/api/v1/reader-blocks/{blockId}/annul', operationId: 'annulBlock', tag: 'Restrictions', summary: 'Анулювати помилкове блокування', body: { $ref: '#/components/schemas/VersionReason' }, idempotency: true, roles: ['manager'], successStatus: 200 },

  { method: 'post', path: '/api/v1/textbook-issue-batches/preview', operationId: 'previewTextbookBatch', tag: 'Textbook batches', summary: 'Перевірити масову видачу без запису', body: { $ref: '#/components/schemas/TextbookBatch' }, successStatus: 200 },
  { method: 'post', path: '/api/v1/textbook-issue-batches', operationId: 'createTextbookBatch', tag: 'Textbook batches', summary: 'Атомарно створити масову видачу', body: { $ref: '#/components/schemas/TextbookBatch' }, idempotency: true },
  { method: 'get', path: '/api/v1/textbook-issue-batches/{batchId}', operationId: 'getTextbookBatch', tag: 'Textbook batches', summary: 'Отримати пакет масової видачі' },

  { method: 'get', path: '/api/v1/reports/{reportType}', operationId: 'getReport', tag: 'Reports', summary: 'Сформувати звіт', query: [queryParameter('dateFrom', 'Початок періоду', { type: 'string', format: 'date' }), queryParameter('dateTo', 'Кінець періоду', { type: 'string', format: 'date' }), queryParameter('className', 'Клас'), queryParameter('category', 'Категорія читача', { type: 'string', enum: ['student', 'employee'] }), queryParameter('blockStatus', 'Статус блокування для звіту blocks', { type: 'string', enum: ['active', 'resolved', 'annulled', 'all'], default: 'active' }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
];

const paths = {};
for (const definition of operations) {
  paths[definition.path] ??= {};
  paths[definition.path][definition.method] = operation(definition);
}

export default {
  openapi: '3.0.4',
  info: {
    title: 'Бібліотека Обрій API',
    version: '1.0.0',
    description: 'HTTP-контракт внутрішнього вебзастосунку бібліотеки ліцею. Усі дати передаються у форматі YYYY-MM-DD, ідентифікатори у JSON — рядками.',
  },
  servers: [{ url: 'http://127.0.0.1:3000', description: 'Локальний backend' }],
  tags: [
    'System', 'Auth', 'Staff', 'Classes', 'Books', 'Copies', 'Readers', 'Loans',
    'Restrictions', 'Textbook batches', 'Reports',
  ].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'obriy_session', description: 'HttpOnly session cookie, яку встановлює маршрут login.' },
    },
    responses: {
      ValidationError: errorResponse(
        'Некоректні вхідні дані.',
        'VALIDATION_ERROR',
        'Перевірте дані операції.',
        { fields: { version: 'Передайте поточну додатну версію запису.' } },
      ),
      Unauthorized: errorResponse('Сесія відсутня або завершилася.', 'AUTHENTICATION_REQUIRED', 'Увійдіть у систему.'),
      Forbidden: errorResponse('Роль не має права на операцію.', 'FORBIDDEN', 'Недостатньо прав для виконання операції.'),
      NotFound: errorResponse('Запитаний запис не знайдено.', 'NOT_FOUND', 'Запис не знайдено.'),
      Conflict: errorResponse('Конфлікт версії, дубліката або конкурентної операції.', 'VERSION_CONFLICT', 'Запис уже змінився. Оновіть дані та повторіть дію.'),
      BusinessRuleError: errorResponse('Операція суперечить бізнес-правилу.', 'BUSINESS_RULE_VIOLATION', 'Операцію неможливо виконати у поточному стані.'),
      InternalError: errorResponse('Неочікувана внутрішня помилка.', 'INTERNAL_ERROR', 'Сталася внутрішня помилка сервера.'),
      ServiceUnavailable: errorResponse('База даних тимчасово недоступна.', 'DATABASE_UNAVAILABLE', 'Сервіс тимчасово недоступний.'),
    },
    schemas: {
      SuccessResponse: {
        type: 'object', required: ['data'],
        properties: { data: {}, meta: { type: 'object', additionalProperties: true } },
      },
      ErrorResponse: {
        type: 'object', required: ['error'],
        properties: { error: { type: 'object', required: ['code', 'message', 'requestId'], properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string', format: 'uuid' }, details: { type: 'object', additionalProperties: true } } } },
      },
      VersionCommand: { type: 'object', required: ['version'], properties: { version: { $ref: '#/components/schemas/Version' } } },
      VersionReason: { type: 'object', required: ['version', 'reason'], properties: { version: { $ref: '#/components/schemas/Version' }, reason: { $ref: '#/components/schemas/Reason' } } },
      Version: { type: 'string', pattern: '^[1-9][0-9]*$', example: '1' },
      PositiveId: { type: 'string', pattern: '^[1-9][0-9]*$', example: '1' },
      Reason: { type: 'string', minLength: 1, maxLength: 500 },
      OptionalComment: { type: 'string', nullable: true, maxLength: 500 },
      Confirmation: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean', enum: [true] } } },
      LoginRequest: { type: 'object', required: ['login', 'password'], properties: { login: { type: 'string', example: 'manager' }, password: { type: 'string', format: 'password' } } },
      ManagerProfile: { type: 'object', required: ['displayName'], properties: { displayName: { type: 'string', minLength: 1, maxLength: 200 } } },
      ManagerPasswordChange: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password', minLength: 1, maxLength: 256 }, newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 128 } } },
      LibrarianPasswordChange: { type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 128 } } },
      StaffActivity: { type: 'object', required: ['isActive'], properties: { isActive: { type: 'boolean' } } },
      LibrarianCreate: { type: 'object', required: ['login', 'displayName', 'password'], properties: { login: { type: 'string' }, displayName: { type: 'string' }, password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 } } },
      ClassCreate: { type: 'object', required: ['name'], properties: { name: { type: 'string', example: '11-А' } } },
      ClassActivity: { type: 'object', required: ['isActive'], properties: { isActive: { type: 'boolean' } } },
      BookCreate: { type: 'object', required: ['title', 'authors', 'publisher'], properties: { title: { type: 'string' }, authors: { type: 'array', minItems: 1, items: { type: 'string' } }, publisher: { type: 'string' }, publicationYear: { type: 'integer', nullable: true, minimum: 1 }, isbn: { type: 'string', nullable: true }, isTextbook: { type: 'boolean', default: false }, confirmDuplicate: { type: 'boolean', default: false } } },
      BookUpdate: { type: 'object', minProperties: 1, properties: { title: { type: 'string' }, authors: { type: 'array', minItems: 1, items: { type: 'string' } }, publisher: { type: 'string' }, publicationYear: { type: 'integer', nullable: true, minimum: 1 }, isbn: { type: 'string', nullable: true }, isTextbook: { type: 'boolean' }, confirmDuplicate: { type: 'boolean' } } },
      BookArchive: { type: 'object', required: ['version', 'confirmArchive'], properties: { version: { $ref: '#/components/schemas/Version' }, reason: { type: 'string', nullable: true, maxLength: 500 }, confirmArchive: { type: 'boolean', enum: [true] } } },
      BookRestore: { type: 'object', required: ['version', 'confirmRestore'], properties: { version: { $ref: '#/components/schemas/Version' }, confirmRestore: { type: 'boolean', enum: [true] } } },
      BookDelete: { type: 'object', required: ['version', 'confirmDelete'], properties: { version: { $ref: '#/components/schemas/Version' }, confirmDelete: { type: 'boolean', enum: [true] } } },
      CopyCreate: { type: 'object', required: ['inventoryNumber', 'condition'], properties: { inventoryNumber: { type: 'string' }, condition: { type: 'string', enum: ['good', 'worn', 'damaged'] }, defectDescription: { type: 'string', nullable: true } } },
      CopyConditionChange: { type: 'object', required: ['condition', 'reason'], properties: { condition: { type: 'string', enum: ['good', 'worn', 'damaged'] }, defectDescription: { type: 'string', nullable: true }, reason: { $ref: '#/components/schemas/Reason' } } },
      CopyTemporaryUnavailability: { type: 'object', required: ['isTemporarilyUnavailable', 'reason'], properties: { isTemporarilyUnavailable: { type: 'boolean' }, reason: { $ref: '#/components/schemas/Reason' } } },
      CopyArchive: { type: 'object', required: ['version', 'confirmArchive'], properties: { version: { $ref: '#/components/schemas/Version' }, reason: { type: 'string', nullable: true, maxLength: 500 }, confirmArchive: { type: 'boolean', enum: [true] } } },
      CopyRestore: { type: 'object', required: ['version', 'confirmRestore'], properties: { version: { $ref: '#/components/schemas/Version' }, confirmRestore: { type: 'boolean', enum: [true] } } },
      CopyDelete: { type: 'object', required: ['version', 'confirmDelete'], properties: { version: { $ref: '#/components/schemas/Version' }, confirmDelete: { type: 'boolean', enum: [true] } } },
      InventoryNumberCorrection: { type: 'object', required: ['version', 'inventoryNumber', 'reason', 'confirmNumberChange'], properties: { version: { $ref: '#/components/schemas/Version' }, inventoryNumber: { type: 'string', minLength: 1, maxLength: 32 }, reason: { $ref: '#/components/schemas/Reason' }, confirmNumberChange: { type: 'boolean', enum: [true] } } },
      CopyWriteOff: { type: 'object', required: ['version', 'reason', 'confirmReportImpact'], properties: { version: { $ref: '#/components/schemas/Version' }, reason: { $ref: '#/components/schemas/Reason' }, confirmReportImpact: { type: 'boolean', enum: [true] } } },
      CopyBookChange: { type: 'object', required: ['version', 'bookId', 'reason', 'confirmBookChange'], properties: { version: { $ref: '#/components/schemas/Version' }, bookId: { $ref: '#/components/schemas/PositiveId' }, reason: { $ref: '#/components/schemas/Reason' }, confirmBookChange: { type: 'boolean', enum: [true] } } },
      ReaderCreate: { type: 'object', required: ['fullName', 'category', 'phone', 'ticketType'], properties: { fullName: { type: 'string' }, category: { type: 'string', enum: ['student', 'employee'] }, classId: { type: 'string', nullable: true }, phone: { type: 'string', pattern: '^\\+380[0-9]{9}$' }, address: { type: 'string', nullable: true }, ticketType: { type: 'string', enum: ['existing', 'electronic'] }, ticketNumber: { type: 'string', nullable: true }, ticketExpiresOn: { type: 'string', format: 'date', nullable: true }, confirmNamesake: { type: 'boolean', default: false } } },
      ReaderUpdate: { type: 'object', minProperties: 1, properties: { fullName: { type: 'string', maxLength: 200 }, category: { type: 'string', enum: ['student', 'employee'] }, classId: { type: 'string', nullable: true, pattern: '^[1-9][0-9]*$' }, phone: { type: 'string', pattern: '^\\+380[0-9]{9}$' }, address: { type: 'string', nullable: true, maxLength: 500 }, ticketNumber: { type: 'string' }, ticketExpiresOn: { type: 'string', format: 'date', nullable: true }, confirmNamesake: { type: 'boolean' }, confirmTicketNumberChange: { type: 'boolean' }, reason: { type: 'string', maxLength: 500 } } },
      EmploymentEnd: { type: 'object', required: ['version', 'employmentEndedOn'], properties: { version: { $ref: '#/components/schemas/Version' }, employmentEndedOn: { type: 'string', format: 'date', nullable: true } } },
      CorrectionCommand: { type: 'object', required: ['version', 'reason', 'confirm'], properties: { version: { type: 'string', pattern: '^[1-9][0-9]*$' }, reason: { type: 'string', minLength: 1, maxLength: 500 }, confirm: { type: 'boolean', enum: [true] }, readerId: { type: 'string', pattern: '^[1-9][0-9]*$' }, copyId: { type: 'string', pattern: '^[1-9][0-9]*$' }, confirmNoTransfer: { type: 'boolean' } } },
      LoanIssue: { type: 'object', required: ['readerId', 'copyId'], properties: { readerId: { $ref: '#/components/schemas/PositiveId' }, copyId: { $ref: '#/components/schemas/PositiveId' }, readerVersion: { $ref: '#/components/schemas/Version' }, copyVersion: { $ref: '#/components/schemas/Version' }, dueDate: { type: 'string', format: 'date', nullable: true, description: 'Дозволено лише для підручника; без значення застосовується стандартний строк 30 днів.' } } },
      LoanReturn: { type: 'object', required: ['version', 'condition'], properties: { version: { $ref: '#/components/schemas/Version' }, condition: { type: 'string', enum: ['good', 'worn', 'damaged'] }, defectDescription: { type: 'string', nullable: true } } },
      LoanExtension: { type: 'object', required: ['version', 'newDueDate', 'reason'], properties: { version: { $ref: '#/components/schemas/Version' }, newDueDate: { type: 'string', format: 'date' }, reason: { $ref: '#/components/schemas/Reason' } } },
      LoanStatusCorrection: { type: 'object', required: ['version', 'status', 'comment', 'confirmCorrection'], properties: { version: { $ref: '#/components/schemas/Version' }, status: { type: 'string', enum: ['issued', 'lost', 'returned', 'compensated'] }, comment: { $ref: '#/components/schemas/Reason' }, confirmCorrection: { type: 'boolean', enum: [true] }, condition: { type: 'string', enum: ['good', 'worn', 'damaged'] }, defectDescription: { type: 'string', nullable: true } } },
      ErroneousReturn: { type: 'object', required: ['version', 'comment', 'confirmCorrection'], properties: { version: { $ref: '#/components/schemas/Version' }, comment: { $ref: '#/components/schemas/Reason' }, confirmCorrection: { type: 'boolean', enum: [true] } } },
      BlockCreate: { type: 'object', required: ['sourceLoanId', 'reasonCode'], properties: { sourceLoanId: { type: 'string' }, reasonCode: { type: 'string', enum: ['overdue', 'unresolved_loss'] } } },
      UnblockRequest: { type: 'object', properties: { comment: { $ref: '#/components/schemas/OptionalComment' } } },
      UnblockCommand: { type: 'object', required: ['version'], properties: { version: { $ref: '#/components/schemas/Version' }, comment: { $ref: '#/components/schemas/OptionalComment' } } },
      UnblockDecision: { type: 'object', required: ['version', 'decision'], properties: { version: { $ref: '#/components/schemas/Version' }, decision: { type: 'string', enum: ['approved', 'rejected'] }, comment: { $ref: '#/components/schemas/OptionalComment' } } },
      TextbookBatch: { type: 'object', required: ['classId', 'dueDate', 'items'], properties: { classId: { type: 'string' }, dueDate: { type: 'string', format: 'date' }, items: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', required: ['readerId', 'copyId'], properties: { readerId: { type: 'string' }, copyId: { type: 'string' } } } } } },
    },
  },
};

