import { AppError } from '../../http/app-error.js';
import { readReportQuery } from '../reports/report-input.js';

function validateId(value, code, message) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new AppError(400, code, message);
}

export class HistoryService {
  constructor(repository) {
    this.repository = repository;
  }

  async listReaderHistory(readerId, searchParams) {
    validateId(readerId, 'INVALID_READER_ID', 'Некоректний читач.');
    const { filters, pagination } = readReportQuery('reader-activity', searchParams);
    const result = await this.repository.listReaderHistory(readerId, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      pageSize: pagination.pageSize,
      offset: pagination.offset,
    });
    return {
      data: result.items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / pagination.pageSize),
      },
    };
  }

  async listLoanAudit(loanId) {
    validateId(loanId, 'INVALID_LOAN_ID', 'Некоректна видача.');
    return await this.repository.listLoanAudit(loanId);
  }
}
