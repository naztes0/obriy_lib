import { AppError } from './app-error.js';

const DEFAULT_LIMIT_BYTES = 16 * 1024;

export async function readJsonBody(request, limitBytes = DEFAULT_LIMIT_BYTES) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Надішліть тіло запиту у форматі JSON.');
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new AppError(413, 'REQUEST_TOO_LARGE', 'Тіло запиту перевищує допустимий розмір.');
    }
    chunks.push(chunk);
  }

  if (size === 0) {
    throw new AppError(400, 'INVALID_JSON', 'Тіло запиту не може бути порожнім.');
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('Expected a JSON object');
    }
    return value;
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Не вдалося прочитати JSON у тілі запиту.');
  }
}
