import { AppError } from '../../http/app-error.js';
import {
  validateIdempotencyKey,
  validateLoanIssue,
  validateLoanReturn,
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

const ISSUE_ERRORS = {
  reader_not_found: [404, 'READER_NOT_FOUND', 'Читача не знайдено.'],
  reader_archived: [422, 'READER_ARCHIVED', 'Архівному читачеві не можна видати примірник.'],
  ticket_expired: [422, 'READER_TICKET_EXPIRED', 'Строк учнівського квитка завершився.'],
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
  constructor(repository, { now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
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
    return await this.getLoan(result.loanId);
  }
}
