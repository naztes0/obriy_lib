import { AppError } from '../../http/app-error.js';
import { validateClassActivity, validateClassName } from './school-class-input.js';

function validateClassId(classId) {
  if (!/^[1-9][0-9]*$/.test(classId)) {
    throw new AppError(400, 'INVALID_CLASS_ID', 'Некоректний ідентифікатор класу.');
  }
}

function duplicateNameError() {
  return new AppError(409, 'CLASS_NAME_EXISTS', 'Клас із такою назвою вже існує.');
}

/**
 * Керує єдиним довідником класів ліцею.
 */
export class SchoolClassService {
  /** @returns {Promise<object>} Підтвердження видалення класу без пов'язаних записів. */
  async remove(classId,input) {
    validateClassId(classId);
    if (input?.confirm !== true) throw new AppError(400,'CONFIRMATION_REQUIRED','Підтвердьте вилучення класу.');
    try { await this.repository.remove(classId); }
    catch (e) { if (e.code==='23503') throw new AppError(409,'CLASS_IN_USE','Клас має пов’язані записи. Спочатку переведіть учнів або очистьте їхній клас.'); throw e; }
    return {id:classId,deleted:true};
  }
  constructor(repository) {
    this.repository = repository;
  }

  /** @returns {Promise<object[]>} Класи відповідного стану активності. */
  async list(searchParams) {
    const status = searchParams.get('status') ?? 'active';
    if (!['active', 'inactive', 'all'].includes(status)) {
      throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
        fields: { status: 'Допустимі значення: active, inactive або all.' },
      });
    }
    return this.repository.list({ status });
  }

  /** @returns {Promise<object>} Створений клас. */
  async create(input) {
    const { name } = validateClassName(input);
    try {
      return await this.repository.create(name);
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'school_classes_name_unique') {
        throw duplicateNameError();
      }
      throw error;
    }
  }

  /** @returns {Promise<object>} Перейменований клас. */
  async rename(classId, input) {
    validateClassId(classId);
    const { name } = validateClassName(input);
    try {
      const schoolClass = await this.repository.updateName(classId, name);
      if (!schoolClass) throw new AppError(404, 'CLASS_NOT_FOUND', 'Клас не знайдено.');
      return schoolClass;
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'school_classes_name_unique') {
        throw duplicateNameError();
      }
      throw error;
    }
  }

  /** @returns {Promise<object>} Клас після зміни активності. */
  async setActive(classId, input) {
    validateClassId(classId);
    const { isActive } = validateClassActivity(input);
    const schoolClass = await this.repository.setActive(classId, isActive);
    if (!schoolClass) throw new AppError(404, 'CLASS_NOT_FOUND', 'Клас не знайдено.');
    return schoolClass;
  }
}
