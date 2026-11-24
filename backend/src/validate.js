const { AppError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);

function str(v, name, { min = 1, max = 255, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new AppError(400, `${name} is required.`);
  }
  if (typeof v !== 'string') throw new AppError(400, `${name} must be text.`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new AppError(400, `${name} must be ${min}-${max} characters.`);
  return t;
}

function int(v, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new AppError(400, `${name} is required.`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, `${name} must be an integer between ${min} and ${max}.`);
  return n;
}

function oneOf(v, name, allowed, { optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return null;
  if (!allowed.includes(v)) throw new AppError(400, `${name} must be one of: ${allowed.join(', ')}.`);
  return v;
}

function password(v) {
  if (typeof v !== 'string' || v.length < 8 || v.length > 128 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) {
    throw new AppError(400, 'Password must be 8-128 characters and contain at least one letter and one digit.');
  }
  return v;
}

function dateStr(v, name, { optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) {
    throw new AppError(400, `${name} must be a date in YYYY-MM-DD format.`);
  }
  return v;
}

module.exports = { isEmail, str, int, oneOf, password, dateStr };
