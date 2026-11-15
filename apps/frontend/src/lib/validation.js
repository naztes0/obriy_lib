export const patterns = {
  personName: "[A-Za-zА-Яа-яІіЇїЄєҐґ'’ʼ\\-]+(?:[ \\t]+[A-Za-zА-Яа-яІіЇїЄєҐґ'’ʼ\\-]+)+",
  phone: '\\+380[0-9]{9}',
  ticket: '[A-Za-zА-Яа-яІіЇїЄєҐґ0-9/-]{1,32}',
  className: '[0-9A-Za-zА-Яа-яІіЇїЄєҐґ .’ʼ\\-]{1,64}',
  staffLogin: '[A-Za-z0-9._-]{3,64}',
};

export function currentKyivYear() {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', year: 'numeric' }).format(new Date()));
}

export function cleanText(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

export function uniqueNonEmpty(values) {
  const seen = new Set();
  return values.map(cleanText).filter((value) => {
    const key = value.toLocaleLowerCase('uk-UA');
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function localizeInvalidEvent(event) {
  const field = event.target;
  if (typeof field?.setCustomValidity !== 'function' || field.validity?.valid) return;
  const { validity } = field;
  let message = 'Перевірте правильність значення.';
  if (validity.valueMissing) message = 'Заповніть це поле.';
  else if (validity.rangeOverflow) message = `Значення має бути не більше ${field.max}.`;
  else if (validity.rangeUnderflow) message = `Значення має бути не менше ${field.min}.`;
  else if (validity.tooLong) message = `Введіть не більше ${field.maxLength} символів.`;
  else if (validity.tooShort) message = `Введіть щонайменше ${field.minLength} символи.`;
  else if (validity.patternMismatch) message = field.title || 'Значення не відповідає потрібному формату.';
  else if (validity.typeMismatch) message = 'Введіть значення у правильному форматі.';
  else if (validity.stepMismatch || validity.badInput) message = 'Введіть коректне числове значення.';
  field.setCustomValidity(message);
}

export function clearValidationMessage(event) {
  if (typeof event.target?.setCustomValidity === 'function') event.target.setCustomValidity('');
}
