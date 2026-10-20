const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSelection, formatSelection } = require('../src/lib/selection');

test('membaca satu nomor dan daftar foto', () => {
  assert.deepEqual(parseSelection('1', { max: 7 }), [1]);
  assert.deepEqual(parseSelection('1,3,5', { max: 7 }), [1, 3, 5]);
  assert.deepEqual(parseSelection('3,1,3', { max: 7 }), [1, 3]);
  assert.deepEqual(parseSelection(' 2 - 4 ', { max: 7 }), [2, 3, 4]);
});

test('membaca rentang dan menggabungkannya dengan daftar', () => {
  assert.deepEqual(parseSelection('2-6', { max: 7 }), [2, 3, 4, 5, 6]);
  assert.deepEqual(parseSelection('1,3,5-7,10', { max: 10 }), [1, 3, 5, 6, 7, 10]);
  assert.deepEqual(parseSelection([3, 1, 3], { max: 7 }), [1, 3]);
});

test('menolak pilihan foto yang tidak valid', () => {
  assert.throws(() => parseSelection('', { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection('0', { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection('5-2', { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection('a', { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection('1,,2', { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection('8', { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection([], { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection([1.5], { max: 7 }), { code: 'INVALID_PHOTO_SELECTION' });
  assert.throws(() => parseSelection(null), { code: 'INVALID_PHOTO_SELECTION' });
});

test('memformat nomor foto dengan tiga digit', () => {
  assert.equal(formatSelection([1, 3, 10]), '001, 003, 010');
});
