import { readReportQuery } from './report-input.js';

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

export class ReportService {
  constructor(repository, { now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async getReport(reportType, searchParams) {
    const { filters, pagination } = readReportQuery(reportType, searchParams);
    const result = await this.repository.getReport(reportType, {
      filters,
      today: dateInKyiv(this.now()),
      pageSize: pagination.pageSize,
      offset: pagination.offset,
    });

    return {
      items: result.items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / pagination.pageSize),
        summary: result.summary,
      },
    };
  }
}
