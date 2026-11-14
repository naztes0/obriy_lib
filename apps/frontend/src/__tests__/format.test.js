import { describe, expect, it } from 'vitest';
import { CONDITION, LOAN_STATUS, formatDate, formatDateTime, todayKyiv } from '../lib/format.js';

describe('formatDate', () => {
  it('перетворює YYYY-MM-DD у дд.мм.рррр без зсуву часового поясу', () => {
    expect(formatDate('2026-11-05')).toBe('05.11.2026');
    expect(formatDate('2026-01-01T00:00:00.000Z')).toBe('01.01.2026');
  });
  it('порожнє значення → тире', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});

describe('formatDateTime (Europe/Kyiv)', () => {
  it('показує час за київським часом: зима UTC+2', () => {
    expect(formatDateTime('2026-01-15T10:30:00Z')).toContain('12:30');
  });
  it('показує час за київським часом: літо UTC+3', () => {
    expect(formatDateTime('2026-07-15T10:30:00Z')).toContain('13:30');
  });
  it('порожнє значення → тире', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });
});

describe('todayKyiv', () => {
  it('повертає дату у форматі YYYY-MM-DD', () => {
    expect(todayKyiv()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('довідники підписів', () => {
  it('містить усі статуси видачі з ТЗ (Ф-02)', () => {
    expect(Object.values(LOAN_STATUS).sort()).toEqual(['Видано', 'Відшкодовано', 'Повернуто', 'Втрачено'].sort());
  });
  it('містить фізичні стани з ТЗ (Ф-06)', () => {
    expect(CONDITION.good).toBe('Добрий');
    expect(CONDITION.worn).toBe('Зношений');
    expect(CONDITION.damaged).toBe('Пошкоджений');
  });
});
