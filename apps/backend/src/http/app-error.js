/**
 * Очікувана прикладна помилка, яку можна безпечно перетворити на HTTP-відповідь.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP-статус.
   * @param {string} code Стабільний машинний код.
   * @param {string} message Українське повідомлення для користувача.
   * @param {object} [details] Додаткові структуровані деталі.
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
