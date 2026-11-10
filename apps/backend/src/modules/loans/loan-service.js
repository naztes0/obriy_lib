import { AppError } from '../../http/app-error.js';
import {
  validateIdempotencyKey,
  validateCopyFound,
  validateLoanExtension,
  validateLoanIssue,
  validateLoanReturn,
  validateLoanStatusChange,
} from './loan-input.js';

function dateInKyiv(now) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function validateLoanId(loanId) {
  if (!/^[1-9][0-9]*$/.test(loanId)) {
    throw new AppError(400, 'INVALID_LOAN_ID', 'Некоректний ідентифікатор видачі.');
  }
}

function validateCopyId(copyId) {
  if (!/^[1-9][0-9]*$/.test(copyId)) {
    throw new AppError(400, 'INVALID_COPY_ID', 'Некоректний ідентифікатор примірника.');
  }
}

function versionConflict() {
  return new AppError(
    409,
    'VERSION_CONFLICT',
    'Запис уже змінився. Оновіть дані та повторіть дію.',
  );
}

const ISSUE_ERRORS = {
  reader_not_found: [404, 'READER_NOT_FOUND', 'Читача не знайдено.'],
  reader_archived: [422, 'READER_ARCHIVED', 'Архівному читачеві не можна видати примірник.'],
  ticket_expired: [422, 'READER_TICKET_EXPIRED', 'Строк учнівського квитка завершився.'],
  employment_ended: [
    422,
    'READER_EMPLOYMENT_ENDED',
    'Працівник завершив роботу в ліцеї та не може отримувати нові примірники.',
  ],
  reader_blocked: [
    422,
    'READER_BLOCKED',
    'Заблокованому читачеві не можна видавати нові примірники.',
  ],
  copy_not_found: [404, 'COPY_NOT_FOUND', 'Примірник не знайдено.'],
  book_archived: [422, 'BOOK_ARCHIVED', 'Архівну книгу не можна видати.'],
  copy_archived: [422, 'COPY_ARCHIVED', 'Архівний примірник не можна видати.'],
  copy_lost: [422, 'COPY_LOST', 'Втрачений примірник не можна видати.'],
  copy_temporarily_unavailable: [
    422,
    'COPY_TEMPORARILY_UNAVAILABLE',
    'Примірник тимчасово недоступний.',
  ],
  copy_condition_unavailable: [
    422,
    'COPY_CONDITION_UNAVAILABLE',
    'Стан примірника не дозволяє видачу.',
  ],
  copy_on_loan: [409, 'COPY_ALREADY_ON_LOAN', 'Примірник уже має незавершену видачу.'],
  custom_due_date_not_allowed: [
    422,
    'CUSTOM_DUE_DATE_NOT_ALLOWED',
    'Власний строк можна вказати лише для підручника.',
  ],
  invalid_due_date: [422, 'INVALID_DUE_DATE', 'Строк повернення не може бути в минулому.'],
};

export class LoanService {
  constructor(
    repository,
    { now = () => new Date(), afterObligationClosed = async () => {} } = {},
  ) {
    this.repository = repository;
    this.now = now;
    this.afterObligationClosed = afterObligationClosed;
  }

  async getLoan(loanId) {
    validateLoanId(loanId);
    const loan = await this.repository.findById(loanId);
    if (!loan) throw new AppError(404, 'LOAN_NOT_FOUND', 'Видачу не знайдено.');
    return loan;
  }

  async issueLoan(input, actor, idempotencyKey) {
    const values = validateLoanIssue(input);
    const requestKey = validateIdempotencyKey(idempotencyKey);
    const issueDate = dateInKyiv(this.now());
    try {
      const result = await this.repository.issueLoan({
        ...values,
        issueDate,
        defaultDueDate: addDays(issueDate, 30),
        actorId: actor.id,
        requestKey,
      });
      if (ISSUE_ERRORS[result.status]) {
        const [status, code, message] = ISSUE_ERRORS[result.status];
        throw new AppError(status, code, message);
      }
      return await this.getLoan(result.loanId);
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'loans_one_open_per_copy') {
        throw new AppError(
          409,
          'COPY_ALREADY_ON_LOAN',
          'Примірник уже має незавершену видачу.',
        );
      }
      throw error;
    }
  }

  async returnLoan(loanId, input, actor, idempotencyKey) {
    validateLoanId(loanId);
    const values = validateLoanReturn(input);
    const requestKey = validateIdempotencyKey(idempotencyKey);
    const result = await this.repository.returnLoan(loanId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    if (result.status === 'loan_not_found') {
      throw new AppError(404, 'LOAN_NOT_FOUND', 'Видачу не знайдено.');
    }
    if (result.status === 'invalid_status') {
      throw new AppError(
        422,
        'LOAN_STATUS_NOT_RETURNABLE',
        'Цю видачу не можна повернути звичайною операцією.',
      );
    }
    if (result.status === 'version_conflict') throw versionConflict();
    const loan = await this.getLoan(result.loanId);
    if (loan.reader?.id) await this.afterObligationClosed(loan.reader.id);
    return await this.getLoan(result.loanId);
  }

  async extendLoan(loanId, input, actor, idempotencyKey) {
    validateLoanId(loanId);
    const values = validateLoanExtension(input);
    const requestKey = validateIdempotencyKey(idempotencyKey);
    const result = await this.repository.extendLoan(loanId, {
      ...values,
      today: dateInKyiv(this.now()),
      actorId: actor.id,
      requestKey,
    });
    const errors = {
      loan_not_found: [404, 'LOAN_NOT_FOUND', 'Видачу не знайдено.'],
      invalid_status: [422, 'LOAN_NOT_EXTENDABLE', 'Цю видачу не можна продовжити.'],
      reader_unavailable: [422, 'READER_UNAVAILABLE', 'Картка читача неактивна або видалена.'],
      extension_period_ended: [422, 'EXTENSION_PERIOD_ENDED', 'Поточний строк видачі вже завершився.'],
      already_extended: [409, 'LOAN_ALREADY_EXTENDED', 'Цю видачу вже продовжували.'],
      invalid_extension_date: [
        422,
        'INVALID_EXTENSION_DATE',
        'Новий строк має бути пізнішим і не більш як на 30 днів.',
      ],
      ticket_limit_exceeded: [
        422,
        'READER_TICKET_LIMIT_EXCEEDED',
        'Новий строк не може бути пізнішим за завершення учнівського квитка.',
      ],
      reader_overdue: [422, 'READER_HAS_OVERDUE_LOANS', 'Читач має прострочені видачі.'],
      reader_has_loss: [422, 'READER_HAS_UNRESOLVED_LOSS', 'Читач має неврегульовану втрату.'],
      employment_ended: [
        422,
        'READER_EMPLOYMENT_ENDED',
        'Працівник завершив роботу в ліцеї, тому продовження недоступне.',
      ],
      reader_blocked: [
        422,
        'READER_BLOCKED',
        'Заблокованому читачеві не можна продовжувати строк видачі.',
      ],
    };
    if (result.status === 'version_conflict') throw versionConflict();
    if (errors[result.status]) {
      const [status, code, message] = errors[result.status];
      throw new AppError(status, code, message);
    }
    return await this.getLoan(result.loanId);
  }

  async markLoanLost(loanId, input, actor, idempotencyKey) {
    validateLoanId(loanId);
    const values = validateLoanStatusChange(input);
    const requestKey = validateIdempotencyKey(idempotencyKey);
    const result = await this.repository.markLoanLost(loanId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    if (result.status === 'loan_not_found') {
      throw new AppError(404, 'LOAN_NOT_FOUND', 'Видачу не знайдено.');
    }
    if (result.status === 'invalid_status') {
      throw new AppError(422, 'LOAN_STATUS_NOT_LOSTABLE', 'Цю видачу не можна позначити втраченою.');
    }
    if (result.status === 'version_conflict') throw versionConflict();
    return await this.getLoan(result.loanId);
  }

  async compensateLoan(loanId, input, actor, idempotencyKey) {
    validateLoanId(loanId);
    const values = validateLoanStatusChange(input);
    const requestKey = validateIdempotencyKey(idempotencyKey);
    const result = await this.repository.compensateLoan(loanId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    if (result.status === 'loan_not_found') {
      throw new AppError(404, 'LOAN_NOT_FOUND', 'Видачу не знайдено.');
    }
    if (result.status === 'invalid_status') {
      throw new AppError(422, 'LOAN_STATUS_NOT_COMPENSATABLE', 'Відшкодувати можна лише втрату.');
    }
    if (result.status === 'version_conflict') throw versionConflict();
    const loan = await this.getLoan(result.loanId);
    if (loan.reader?.id) await this.afterObligationClosed(loan.reader.id);
    return await this.getLoan(result.loanId);
  }

  async markCopyFound(copyId, input, actor, idempotencyKey) {
    validateCopyId(copyId);
    const values = validateCopyFound(input);
    const requestKey = validateIdempotencyKey(idempotencyKey);
    const result = await this.repository.markCopyFound(copyId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    if (result.status === 'copy_not_found') {
      throw new AppError(404, 'COPY_NOT_FOUND', 'Примірник не знайдено.');
    }
    if (result.status === 'copy_not_lost') {
      throw new AppError(422, 'COPY_NOT_LOST', 'Примірник не позначений втраченим.');
    }
    if (result.status === 'copy_has_open_loan') {
      throw new AppError(
        422,
        'COPY_HAS_OPEN_LOAN',
        'Спочатку поверніть примірник у межах чинної видачі.',
      );
    }
    if (result.status === 'version_conflict') throw versionConflict();
    return await this.repository.findCopyById(result.copyId);
  }
}
