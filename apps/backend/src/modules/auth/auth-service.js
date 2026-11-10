import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '../../http/app-error.js';
import { verifyPassword } from './password.js';

const INVALID_CREDENTIALS = new AppError(401, 'INVALID_CREDENTIALS', 'Неправильний логін або пароль.');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicStaff(account) {
  return {
    id: String(account.id),
    login: account.login,
    displayName: account.display_name,
    role: account.role,
  };
}

export class AuthService {
  constructor(repository, { sessionTtlMilliseconds, now = () => new Date() }) {
    this.repository = repository;
    this.sessionTtlMilliseconds = sessionTtlMilliseconds;
    this.now = now;
  }

  async login({ login, password }) {
    const normalizedLogin = typeof login === 'string' ? login.trim() : '';
    const validPasswordShape = typeof password === 'string' && password.length >= 1 && password.length <= 256;

    if (!normalizedLogin || normalizedLogin.length > 64 || !validPasswordShape) {
      throw INVALID_CREDENTIALS;
    }

    const account = await this.repository.findAccountByLogin(normalizedLogin);
    const passwordMatches = await verifyPassword(password, account?.password_hash);
    if (!account || !account.is_active || !passwordMatches) {
      throw INVALID_CREDENTIALS;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + this.sessionTtlMilliseconds);
    await this.repository.createSession({
      id: randomUUID(),
      staffId: account.id,
      tokenHash: hashToken(token),
      expiresAt,
    });

    return { token, expiresAt, staff: publicStaff(account) };
  }

  async authenticateToken(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Увійдіть у систему.');
    }

    const session = await this.repository.findActiveSession(hashToken(token));
    if (!session) {
      throw new AppError(401, 'SESSION_EXPIRED', 'Сеанс завершився. Увійдіть повторно.');
    }

    return publicStaff(session);
  }

  async logout(token) {
    if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await this.repository.revokeSession(hashToken(token));
    }
  }
}
