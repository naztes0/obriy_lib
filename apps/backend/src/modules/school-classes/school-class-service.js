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

export class SchoolClassService {
  constructor(repository) {
    this.repository = repository;
  }

  async list(searchParams) {
    const status = searchParams.get('status') ?? 'active';
    if (!['active', 'inactive', 'all'].includes(status)) {
      throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
        fields: { status: 'Допустимі значення: active, inactive або all.' },
      });
    }
    return this.repository.list({ status });
  }

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

  async setActive(classId, input) {
    validateClassId(classId);
    const { isActive } = validateClassActivity(input);
    const schoolClass = await this.repository.setActive(classId, isActive);
    if (!schoolClass) throw new AppError(404, 'CLASS_NOT_FOUND', 'Клас не знайдено.');
    return schoolClass;
  }
}
