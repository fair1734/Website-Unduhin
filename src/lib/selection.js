const { AppError } = require('./errors');

const MAX_SELECTION_INDEX = 10000;

function invalid(message) {
  return new AppError('INVALID_PHOTO_SELECTION', message, 400);
}

function readNumber(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw invalid('Nomor foto harus berupa bilangan bulat.');
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  throw invalid('Format pilihan foto tidak valid.');
}

function addIndex(indices, value, max) {
  const number = readNumber(value);
  if (number < 1) throw invalid('Nomor foto dimulai dari 1.');
  if (max && number > max) {
    throw invalid(`Nomor foto ${number} melebihi batas ${max} foto.`);
  }
  if (number > MAX_SELECTION_INDEX) {
    throw invalid(`Nomor foto ${number} terlalu besar.`);
  }
  indices.add(number);
}

function parseString(spec, max) {
  const indices = new Set();
  for (const rawToken of spec.split(',')) {
    const token = rawToken.trim();
    if (!token) throw invalid('Pilihan foto tidak boleh berisi bagian kosong.');

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      if (start < 1 || end < 1) throw invalid('Nomor foto dimulai dari 1.');
      if (start > end) throw invalid('Rentang foto harus berurutan, misalnya 2-5.');
      if (max && end > max) {
        throw invalid(`Nomor foto ${end} melebihi batas ${max} foto.`);
      }
      if (end > MAX_SELECTION_INDEX) {
        throw invalid(`Nomor foto ${end} terlalu besar.`);
      }
      for (let value = start; value <= end; value++) indices.add(value);
      continue;
    }

    if (!/^\d+$/.test(token)) {
      throw invalid('Gunakan format angka, misalnya 1,3,5-7.');
    }
    addIndex(indices, token, max);
  }
  return indices;
}

function parseSelection(input, options = {}) {
  const max = Number.isInteger(options.max) && options.max > 0 ? options.max : 0;
  if (input === null || input === undefined) {
    if (options.allowEmpty) return [];
    throw invalid('Pilih minimal satu foto.');
  }

  let indices;
  if (Array.isArray(input)) {
    if (input.length === 0) {
      if (options.allowEmpty) return [];
      throw invalid('Pilih minimal satu foto.');
    }
    indices = new Set();
    for (const value of input) addIndex(indices, value, max);
  } else if (typeof input === 'string') {
    const spec = input.trim();
    if (!spec) {
      if (options.allowEmpty) return [];
      throw invalid('Pilih minimal satu foto.');
    }
    indices = parseString(spec, max);
  } else {
    throw invalid('Format pilihan foto tidak valid.');
  }

  if (indices.size === 0) {
    if (options.allowEmpty) return [];
    throw invalid('Pilih minimal satu foto.');
  }
  if (max && indices.size > max) {
    throw invalid(`Maksimal ${max} foto per unduhan.`);
  }

  return [...indices].sort((a, b) => a - b);
}

function formatSelection(indices) {
  return indices.map((index) => String(index).padStart(3, '0')).join(', ');
}

module.exports = { parseSelection, formatSelection };
