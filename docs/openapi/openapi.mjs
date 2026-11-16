const pathParameter = (name) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[1-9][0-9]*$' },
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

const jsonBody = (schema = { $ref: '#/components/schemas/CommandBody' }) => ({
  required: true,
  content: { 'application/json': { schema } },
});

function operation({
  operationId,
  tag,
  summary,
  method,
  path,
  body,
  idempotency = false,
  manager = false,
  security = true,
  query = [],
  successStatus,
  successDescription = 'Операцію виконано успішно.',
  responseContent = true,
}) {
  const pathNames = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const parameters = [
    ...pathNames.map(pathParameter),
    ...query,
    ...(idempotency ? [idempotencyParameter] : []),
  ];
  const status = String(successStatus ?? (method === 'post' ? 201 : 200));
  const result = {
    operationId,
    tags: [tag],
    summary,
    ...(manager ? { description: 'Доступно лише завідувачу бібліотеки.' } : {}),
    ...(security ? { security: [{ cookieAuth: [] }] } : { security: [] }),
    ...(parameters.length ? { parameters } : {}),
    ...(body ? { requestBody: jsonBody(body) } : {}),
    responses: {
      [status]: {
        description: successDescription,
        ...(responseContent ? {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } },
        } : {}),
      },
      ...(security ? { '401': { $ref: '#/components/responses/Unauthorized' } } : {}),
      ...(manager ? { '403': { $ref: '#/components/responses/Forbidden' } } : {}),
      '400': { $ref: '#/components/responses/ValidationError' },
      '409': { $ref: '#/components/responses/Conflict' },
      '422': { $ref: '#/components/responses/BusinessRuleError' },
    },
  };
  return result;
}

const operations = [
  { method: 'get', path: '/health', operationId: 'getHealth', tag: 'System', summary: 'Перевірити сервер і підключення до БД', security: false },
  { method: 'post', path: '/api/v1/auth/login', operationId: 'login', tag: 'Auth', summary: 'Увійти до системи', security: false, body: { $ref: '#/components/schemas/LoginRequest' }, successStatus: 200 },
  { method: 'get', path: '/api/v1/auth/session', operationId: 'getSession', tag: 'Auth', summary: 'Отримати поточну сесію' },
  { method: 'post', path: '/api/v1/auth/logout', operationId: 'logout', tag: 'Auth', summary: 'Завершити поточну сесію', successStatus: 200 },

  { method: 'get', path: '/api/v1/staff', operationId: 'listStaff', tag: 'Staff', summary: 'Отримати працівників', manager: true, query: [queryParameter('activity', 'active, inactive або all'), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'post', path: '/api/v1/staff', operationId: 'createLibrarian', tag: 'Staff', summary: 'Створити бібліотекаря', manager: true, body: { $ref: '#/components/schemas/LibrarianCreate' } },
  { method: 'patch', path: '/api/v1/staff/me', operationId: 'updateManagerProfile', tag: 'Staff', summary: 'Змінити ім’я завідувача', manager: true, body: { $ref: '#/components/schemas/CommandBody' } },
  { method: 'patch', path: '/api/v1/staff/me/password', operationId: 'changeManagerPassword', tag: 'Staff', summary: 'Змінити власний пароль завідувача', manager: true, body: { $ref: '#/components/schemas/PasswordChange' } },
  { method: 'patch', path: '/api/v1/staff/{staffId}/activity', operationId: 'setLibrarianActivity', tag: 'Staff', summary: 'Активувати або деактивувати бібліотекаря', manager: true, body: { $ref: '#/components/schemas/CommandBody' } },
  { method: 'patch', path: '/api/v1/staff/{staffId}/password', operationId: 'changeLibrarianPassword', tag: 'Staff', summary: 'Змінити пароль бібліотекаря', manager: true, body: { $ref: '#/components/schemas/PasswordChange' } },

  { method: 'get', path: '/api/v1/school-classes', operationId: 'listClasses', tag: 'Classes', summary: 'Отримати класи', query: [queryParameter('status', 'active, inactive або all')] },
  { method: 'post', path: '/api/v1/school-classes', operationId: 'createClass', tag: 'Classes', summary: 'Створити клас', manager: true, body: { $ref: '#/components/schemas/ClassCreate' } },
  { method: 'patch', path: '/api/v1/school-classes/{classId}', operationId: 'renameClass', tag: 'Classes', summary: 'Перейменувати клас', manager: true, body: { $ref: '#/components/schemas/ClassCreate' } },
  { method: 'patch', path: '/api/v1/school-classes/{classId}/activity', operationId: 'setClassActivity', tag: 'Classes', summary: 'Змінити активність класу', manager: true, body: { $ref: '#/components/schemas/CommandBody' } },
  { method: 'post', path: '/api/v1/school-classes/{classId}/delete', operationId: 'deleteClass', tag: 'Classes', summary: 'Видалити клас без пов’язаних записів', manager: true, body: { $ref: '#/components/schemas/CommandBody' }, successStatus: 200 },

  { method: 'get', path: '/api/v1/books', operationId: 'listBooks', tag: 'Books', summary: 'Знайти видання', query: [queryParameter('title', 'Фрагмент назви'), queryParameter('author', 'Фрагмент автора'), queryParameter('publisher', 'Фрагмент видавництва'), queryParameter('archived', 'active, archived або all'), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'get', path: '/api/v1/books/{bookId}', operationId: 'getBook', tag: 'Books', summary: 'Отримати картку видання' },
  { method: 'post', path: '/api/v1/books', operationId: 'createBook', tag: 'Books', summary: 'Створити видання', body: { $ref: '#/components/schemas/BookCreate' } },
  { method: 'patch', path: '/api/v1/books/{bookId}', operationId: 'updateBook', tag: 'Books', summary: 'Відредагувати видання', body: { $ref: '#/components/schemas/BookUpdate' } },
  { method: 'post', path: '/api/v1/books/{bookId}/archive', operationId: 'archiveBook', tag: 'Books', summary: 'Архівувати видання', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/books/{bookId}/restore', operationId: 'restoreBook', tag: 'Books', summary: 'Відновити видання', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/books/{bookId}/delete', operationId: 'deleteBook', tag: 'Books', summary: 'Видалити невикористане видання', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, manager: true, successStatus: 200 },

  { method: 'post', path: '/api/v1/books/{bookId}/copies', operationId: 'createCopy', tag: 'Copies', summary: 'Додати фізичний примірник', body: { $ref: '#/components/schemas/CopyCreate' } },
  { method: 'patch', path: '/api/v1/copies/{copyId}/condition', operationId: 'changeCopyCondition', tag: 'Copies', summary: 'Змінити фізичний стан примірника', body: { $ref: '#/components/schemas/CommandBody' } },
  { method: 'patch', path: '/api/v1/copies/{copyId}/temporary-unavailability', operationId: 'setCopyUnavailable', tag: 'Copies', summary: 'Змінити тимчасову недоступність', body: { $ref: '#/components/schemas/CommandBody' } },
  { method: 'post', path: '/api/v1/copies/{copyId}/loss', operationId: 'markCopyLostInFund', tag: 'Copies', summary: 'Зафіксувати втрату примірника у фонді', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, successStatus: 200 },
  { method: 'get', path: '/api/v1/copies/{copyId}/history', operationId: 'getCopyHistory', tag: 'Copies', summary: 'Отримати історію примірника' },
  { method: 'post', path: '/api/v1/copies/{copyId}/archive', operationId: 'archiveCopy', tag: 'Copies', summary: 'Архівувати примірник', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{copyId}/restore', operationId: 'restoreCopy', tag: 'Copies', summary: 'Відновити примірник', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{copyId}/delete', operationId: 'deleteCopy', tag: 'Copies', summary: 'Видалити примірник без історії', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'patch', path: '/api/v1/copies/{copyId}/inventory-number', operationId: 'correctInventoryNumber', tag: 'Copies', summary: 'Виправити інвентарний номер', body: { $ref: '#/components/schemas/CommandBody' }, idempotency: true, manager: true },
  { method: 'post', path: '/api/v1/copies/{copyId}/write-off', operationId: 'writeOffCopy', tag: 'Copies', summary: 'Остаточно списати примірник', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'patch', path: '/api/v1/copies/{copyId}/book', operationId: 'changeCopyBook', tag: 'Copies', summary: 'Змінити прив’язку примірника до видання', body: { $ref: '#/components/schemas/CommandBody' }, idempotency: true },
  { method: 'post', path: '/api/v1/copies/{id}/correct-loss', operationId: 'correctFundLoss', tag: 'Copies', summary: 'Скасувати помилкову втрату примірника у фонді', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{id}/settle-loss', operationId: 'settleFundLoss', tag: 'Copies', summary: 'Врегулювати втрату примірника у фонді', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, manager: true, successStatus: 200 },

  { method: 'get', path: '/api/v1/readers', operationId: 'listReaders', tag: 'Readers', summary: 'Знайти читачів', query: [queryParameter('q', 'ПІБ або номер квитка'), queryParameter('archived', 'active, archived або all'), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'get', path: '/api/v1/readers/{readerId}', operationId: 'getReader', tag: 'Readers', summary: 'Отримати картку читача' },
  { method: 'get', path: '/api/v1/readers/{readerId}/ticket.pdf', operationId: 'downloadTicket', tag: 'Readers', summary: 'Завантажити електронний квиток', responseContent: false },
  { method: 'post', path: '/api/v1/readers', operationId: 'createReader', tag: 'Readers', summary: 'Створити читача', body: { $ref: '#/components/schemas/ReaderCreate' } },
  { method: 'patch', path: '/api/v1/readers/{readerId}', operationId: 'updateReader', tag: 'Readers', summary: 'Відредагувати читача', body: { $ref: '#/components/schemas/CommandBody' } },
  { method: 'post', path: '/api/v1/readers/{readerId}/archive', operationId: 'archiveReader', tag: 'Readers', summary: 'Архівувати читача', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/readers/{readerId}/restore', operationId: 'restoreReader', tag: 'Readers', summary: 'Відновити читача', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'patch', path: '/api/v1/readers/{readerId}/employment-end', operationId: 'setEmploymentEnd', tag: 'Readers', summary: 'Змінити дату звільнення працівника', body: { $ref: '#/components/schemas/EmploymentEnd' } },
  { method: 'get', path: '/api/v1/readers/{readerId}/history', operationId: 'getReaderHistory', tag: 'Readers', summary: 'Отримати розширену історію читача', query: [queryParameter('dateFrom', 'Початок періоду', { type: 'string', format: 'date' }), queryParameter('dateTo', 'Кінець періоду', { type: 'string', format: 'date' }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },

  { method: 'get', path: '/api/v1/loans/{loanId}', operationId: 'getLoan', tag: 'Loans', summary: 'Отримати видачу' },
  { method: 'post', path: '/api/v1/loans', operationId: 'issueLoan', tag: 'Loans', summary: 'Видати примірник', body: { $ref: '#/components/schemas/LoanIssue' }, idempotency: true },
  { method: 'post', path: '/api/v1/loans/{loanId}/return', operationId: 'returnLoan', tag: 'Loans', summary: 'Повернути примірник', body: { $ref: '#/components/schemas/LoanReturn' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/extend', operationId: 'extendLoan', tag: 'Loans', summary: 'Продовжити строк видачі', body: { $ref: '#/components/schemas/CommandBody' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/loss', operationId: 'markLoanLost', tag: 'Loans', summary: 'Зафіксувати втрату на руках', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/compensate', operationId: 'compensateLoan', tag: 'Loans', summary: 'Підтвердити компенсацію втрати', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/copies/{copyId}/found', operationId: 'markCopyFound', tag: 'Loans', summary: 'Повернути знайдений примірник до фонду', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/correct-status', operationId: 'correctLoanStatus', tag: 'Loans', summary: 'Виправити помилковий статус видачі', body: { $ref: '#/components/schemas/CommandBody' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{loanId}/erroneous-return', operationId: 'recordErroneousReturn', tag: 'Loans', summary: 'Зафіксувати помилкове повернення', body: { $ref: '#/components/schemas/CommandBody' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'get', path: '/api/v1/loans/{loanId}/audit', operationId: 'getLoanAudit', tag: 'Loans', summary: 'Отримати аудит виправлень видачі' },
  { method: 'post', path: '/api/v1/loans/{id}/correct-participants', operationId: 'correctLoanParticipants', tag: 'Loans', summary: 'Виправити читача або примірник у видачі', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/loans/{id}/void', operationId: 'voidLoan', tag: 'Loans', summary: 'Вилучити помилкову видачу без фактичної передачі', body: { $ref: '#/components/schemas/CorrectionCommand' }, idempotency: true, manager: true, successStatus: 200 },

  { method: 'get', path: '/api/v1/restrictions', operationId: 'listRestrictions', tag: 'Restrictions', summary: 'Отримати активні блокування', query: [queryParameter('pending', 'Лише блокування із запитом на розгляд', { type: 'boolean' }), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'get', path: '/api/v1/readers/{readerId}/blocks', operationId: 'listReaderBlocks', tag: 'Restrictions', summary: 'Отримати історію блокувань' },
  { method: 'post', path: '/api/v1/readers/{readerId}/blocks', operationId: 'confirmReaderBlock', tag: 'Restrictions', summary: 'Підтвердити блокування читача', body: { $ref: '#/components/schemas/BlockCreate' }, idempotency: true },
  { method: 'post', path: '/api/v1/reader-blocks/{blockId}/unblock-requests', operationId: 'requestUnblock', tag: 'Restrictions', summary: 'Подати запит на розблокування', body: { $ref: '#/components/schemas/CommandBody' }, idempotency: true },
  { method: 'post', path: '/api/v1/reader-blocks/{blockId}/unblock', operationId: 'unblockReader', tag: 'Restrictions', summary: 'Розблокувати читача', body: { $ref: '#/components/schemas/VersionCommand' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/reader-unblock-requests/{requestId}/decision', operationId: 'decideUnblock', tag: 'Restrictions', summary: 'Розглянути запит на розблокування', body: { $ref: '#/components/schemas/CommandBody' }, idempotency: true, manager: true, successStatus: 200 },
  { method: 'post', path: '/api/v1/reader-blocks/{blockId}/annul', operationId: 'annulBlock', tag: 'Restrictions', summary: 'Анулювати помилкове блокування', body: { $ref: '#/components/schemas/LifecycleCommand' }, idempotency: true, manager: true, successStatus: 200 },

  { method: 'post', path: '/api/v1/textbook-issue-batches/preview', operationId: 'previewTextbookBatch', tag: 'Textbook batches', summary: 'Перевірити масову видачу без запису', body: { $ref: '#/components/schemas/TextbookBatch' }, successStatus: 200 },
  { method: 'post', path: '/api/v1/textbook-issue-batches', operationId: 'createTextbookBatch', tag: 'Textbook batches', summary: 'Атомарно створити масову видачу', body: { $ref: '#/components/schemas/TextbookBatch' }, idempotency: true },
  { method: 'get', path: '/api/v1/textbook-issue-batches/{batchId}', operationId: 'getTextbookBatch', tag: 'Textbook batches', summary: 'Отримати пакет масової видачі' },

  { method: 'get', path: '/api/v1/reports/{reportType}', operationId: 'getReport', tag: 'Reports', summary: 'Сформувати звіт', query: [queryParameter('dateFrom', 'Початок періоду', { type: 'string', format: 'date' }), queryParameter('dateTo', 'Кінець періоду', { type: 'string', format: 'date' }), queryParameter('className', 'Клас'), queryParameter('category', 'student або employee'), queryParameter('page', 'Номер сторінки', { type: 'integer', minimum: 1 }), queryParameter('pageSize', 'Розмір сторінки', { type: 'integer', minimum: 1, maximum: 100 })] },
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
      ValidationError: { description: 'Некоректні вхідні дані.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Unauthorized: { description: 'Сесія відсутня або завершилася.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Forbidden: { description: 'Роль не має права на операцію.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Conflict: { description: 'Конфлікт версії, дубліката або конкурентної операції.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      BusinessRuleError: { description: 'Операція суперечить бізнес-правилу.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
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
      CommandBody: { type: 'object', additionalProperties: true, description: 'Точний набір полів залежить від команди; див. JSDoc відповідного input-validator.' },
      VersionCommand: { type: 'object', required: ['version'], properties: { version: { type: 'string', pattern: '^[1-9][0-9]*$' }, comment: { type: 'string' } } },
      LifecycleCommand: { type: 'object', required: ['version', 'reason'], properties: { version: { type: 'string', pattern: '^[1-9][0-9]*$' }, reason: { type: 'string', minLength: 1 }, confirm: { type: 'boolean' } } },
      LoginRequest: { type: 'object', required: ['login', 'password'], properties: { login: { type: 'string', example: 'manager' }, password: { type: 'string', format: 'password' } } },
      PasswordChange: { type: 'object', required: ['newPassword'], properties: { currentPassword: { type: 'string', format: 'password' }, newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 128 } } },
      LibrarianCreate: { type: 'object', required: ['login', 'displayName', 'password'], properties: { login: { type: 'string' }, displayName: { type: 'string' }, password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 } } },
      ClassCreate: { type: 'object', required: ['name'], properties: { name: { type: 'string', example: '11-А' } } },
      BookCreate: { type: 'object', required: ['title', 'authors', 'publisher', 'isTextbook'], properties: { title: { type: 'string' }, authors: { type: 'array', minItems: 1, items: { type: 'string' } }, publisher: { type: 'string' }, publicationYear: { type: 'integer', nullable: true, minimum: 1 }, isbn: { type: 'string', nullable: true }, isTextbook: { type: 'boolean' }, confirmDuplicate: { type: 'boolean', default: false } } },
      BookUpdate: { type: 'object', minProperties: 1, properties: { title: { type: 'string' }, authors: { type: 'array', minItems: 1, items: { type: 'string' } }, publisher: { type: 'string' }, publicationYear: { type: 'integer', nullable: true, minimum: 1 }, isbn: { type: 'string', nullable: true }, isTextbook: { type: 'boolean' }, confirmDuplicate: { type: 'boolean' } } },
      CopyCreate: { type: 'object', required: ['inventoryNumber', 'condition'], properties: { inventoryNumber: { type: 'string' }, condition: { type: 'string', enum: ['good', 'worn', 'damaged'] }, defectDescription: { type: 'string', nullable: true } } },
      ReaderCreate: { type: 'object', required: ['fullName', 'category', 'phone', 'ticketType'], properties: { fullName: { type: 'string' }, category: { type: 'string', enum: ['student', 'employee'] }, classId: { type: 'string', nullable: true }, phone: { type: 'string', pattern: '^\\+380[0-9]{9}$' }, address: { type: 'string', nullable: true }, ticketType: { type: 'string', enum: ['existing', 'electronic'] }, ticketNumber: { type: 'string', nullable: true }, ticketExpiresOn: { type: 'string', format: 'date', nullable: true }, confirmNamesake: { type: 'boolean', default: false } } },
      EmploymentEnd: { type: 'object', required: ['version', 'employmentEndedOn'], properties: { version: { type: 'string' }, employmentEndedOn: { type: 'string', format: 'date', nullable: true } } },
      CorrectionCommand: { type: 'object', required: ['version', 'reason', 'confirm'], properties: { version: { type: 'string', pattern: '^[1-9][0-9]*$' }, reason: { type: 'string', minLength: 1, maxLength: 500 }, confirm: { type: 'boolean', enum: [true] }, readerId: { type: 'string', pattern: '^[1-9][0-9]*$' }, copyId: { type: 'string', pattern: '^[1-9][0-9]*$' }, confirmNoTransfer: { type: 'boolean' } } },
      LoanIssue: { type: 'object', required: ['readerId', 'copyId'], properties: { readerId: { type: 'string' }, copyId: { type: 'string' }, dueDate: { type: 'string', format: 'date', description: 'Дозволено лише для підручника.' } } },
      LoanReturn: { type: 'object', required: ['version', 'condition'], properties: { version: { type: 'string' }, condition: { type: 'string', enum: ['good', 'worn', 'damaged'] }, defectDescription: { type: 'string', nullable: true } } },
      BlockCreate: { type: 'object', required: ['sourceLoanId', 'reasonCode'], properties: { sourceLoanId: { type: 'string' }, reasonCode: { type: 'string', enum: ['overdue', 'unresolved_loss'] } } },
      TextbookBatch: { type: 'object', required: ['classId', 'dueDate', 'items'], properties: { classId: { type: 'string' }, dueDate: { type: 'string', format: 'date' }, items: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', required: ['readerId', 'copyId'], properties: { readerId: { type: 'string' }, copyId: { type: 'string' } } } } } },
    },
  },
};

