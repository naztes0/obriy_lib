import { AppError } from '../../http/app-error.js';
import { readPagination } from '../../http/pagination.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  readStaffId,
  validateLibrarianCreate,
  validateLibrarianPassword,
  validateManagerPassword,
  validateManagerProfile,
  validateStaffActivity,
} from './staff-input.js';

function publicStaff(row) {
  return {
    id: String(row.id),
    login: row.login,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function staffNotFound() {
  return new AppError(404, 'STAFF_NOT_FOUND', 'Обліковий запис працівника не знайдено.');
}

function managerProtected() {
  return new AppError(
    422,
    'MANAGER_ACCOUNT_PROTECTED',
    'Ця дія доступна лише для акаунтів бібліотекарів.',
  );
}

/**
 * Керує бібліотекарями та власним профілем єдиного завідувача.
 */
export class StaffService {
  constructor(repository) {
    this.repository = repository;
  }

  /** @returns {Promise<object>} Сторінка активних або деактивованих працівників. */
  async listStaff(searchParams) {
    const pagination = readPagination(searchParams);
    const activity = searchParams.get('activity') ?? 'all';
    if (!['active', 'inactive', 'all'].includes(activity)) {
      throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
        fields: { activity: 'Допустимі значення: active, inactive або all.' },
      });
    }
    const result = await this.repository.listStaff({
      activity,
      pageSize: pagination.pageSize,
      offset: pagination.offset,
    });
    return {
      items: result.staff,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / pagination.pageSize),
      },
    };
  }

  /** @returns {Promise<object>} Створений акаунт із роллю `librarian`. */
  async createLibrarian(input) {
    const values = validateLibrarianCreate(input);
    const result = await this.repository.createLibrarian({
      login: values.login,
      displayName: values.displayName,
      passwordHash: await hashPassword(values.password),
    });
    if (result.status === 'duplicate_login') {
      throw new AppError(409, 'STAFF_LOGIN_EXISTS', 'Працівник із таким логіном уже існує.');
    }
    const created = await this.repository.findStaffById(result.staffId);
    return publicStaff(created);
  }

  /** @returns {Promise<object>} Бібліотекар після зміни активності. */
  async setLibrarianActivity(staffId, input) {
    const id = readStaffId(staffId);
    const { isActive } = validateStaffActivity(input);
    const result = await this.repository.setLibrarianActivity(id, isActive);
    if (result.status === 'not_found') throw staffNotFound();
    if (result.status === 'manager_protected') throw managerProtected();
    return publicStaff(await this.repository.findStaffById(id));
  }

  /** @returns {Promise<object>} Підтвердження зміни пароля й відкликання сесій. */
  async changeLibrarianPassword(staffId, input) {
    const id = readStaffId(staffId);
    const { newPassword } = validateLibrarianPassword(input);
    const result = await this.repository.changeLibrarianPassword(
      id,
      await hashPassword(newPassword),
    );
    if (result.status === 'not_found') throw staffNotFound();
    if (result.status === 'manager_protected') throw managerProtected();
    return { staffId: id, sessionsRevoked: true };
  }

  /** @returns {Promise<object>} Завідувач з оновленим відображуваним ім'ям. */
  async updateOwnProfile(actor, input) {
    const { displayName } = validateManagerProfile(input);
    const result = await this.repository.updateManagerProfile(actor.id, displayName);
    if (result.status === 'not_found') throw staffNotFound();
    return publicStaff(await this.repository.findStaffById(actor.id));
  }

  /** @returns {Promise<object>} Підтвердження безпечної зміни власного пароля. */
  async changeOwnPassword(actor, input) {
    const { currentPassword, newPassword } = validateManagerPassword(input);
    const account = await this.repository.findStaffById(actor.id);
    if (!account || account.role !== 'manager') throw staffNotFound();
    if (!(await verifyPassword(currentPassword, account.password_hash))) {
      throw new AppError(401, 'CURRENT_PASSWORD_INVALID', 'Поточний пароль неправильний.');
    }
    if (await verifyPassword(newPassword, account.password_hash)) {
      throw new AppError(422, 'PASSWORD_UNCHANGED', 'Новий пароль має відрізнятися від поточного.');
    }
    const result = await this.repository.changeManagerPassword(
      actor.id,
      account.password_hash,
      await hashPassword(newPassword),
    );
    if (result.status === 'concurrent_change') {
      throw new AppError(
        409,
        'PASSWORD_CHANGED_CONCURRENTLY',
        'Пароль уже було змінено. Увійдіть повторно.',
      );
    }
    if (result.status === 'not_found') throw staffNotFound();
    return { staffId: String(actor.id), sessionsRevoked: true };
  }
}
