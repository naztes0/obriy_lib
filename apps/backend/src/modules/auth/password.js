import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DUMMY_SALT = 'obriy-invalid-login-placeholder';

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash) {
    await scrypt(password, DUMMY_SALT, 64);
    return false;
  }

  const [algorithm, salt, expectedHex] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !/^[0-9a-f]{128}$/i.test(expectedHex ?? '')) {
    await scrypt(password, DUMMY_SALT, 64);
    return false;
  }

  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(actual, expected);
}
