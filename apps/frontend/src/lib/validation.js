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
