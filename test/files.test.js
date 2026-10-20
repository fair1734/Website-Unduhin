const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAudio,
  isMediaFile,
  mimeFor,
  sanitizeFilename,
  contentDisposition
} = require('../src/lib/files');
const { mapToolError } = require('../src/lib/errors');

test('mengenali file audio sebagai media', () => {
  assert.equal(isAudio('/tmp/hasil.mp3'), true);
  assert.equal(isAudio('/tmp/hasil.m4a'), true);
  assert.equal(isMediaFile('/tmp/hasil.mp3'), true);
  assert.equal(isMediaFile('/tmp/hasil.mp4'), true);
  assert.equal(isMediaFile('/tmp/hasil.txt'), false);
  assert.equal(mimeFor('/tmp/hasil.mp3'), 'audio/mpeg');
});

test('membersihkan nama file dan menyusun Content-Disposition', () => {
  assert.equal(sanitizeFilename(' video: baru?.mp4 '), 'video- baru-.mp4');
  const header = contentDisposition('foto café.jpg');
  assert.match(header, /^attachment;/);
  assert.match(header, /filename\*=UTF-8''/);
});

test('memetakan error format sebelum error ketersediaan', () => {
  assert.equal(mapToolError('ERROR: Requested format is not available').code, 'FORMAT_UNAVAILABLE');
  assert.equal(mapToolError('ERROR: no media found').code, 'NO_MEDIA');
  assert.equal(mapToolError('ERROR: This video is unavailable').code, 'UNAVAILABLE');
  assert.equal(mapToolError('ERROR: HTTP Error 404: Not Found').code, 'UNAVAILABLE');
  assert.equal(mapToolError('ERROR: HTTP Error 429: Too Many Requests').code, 'RATE_LIMITED');
  assert.equal(mapToolError('ERROR: HTTP Error 403: Forbidden').code, 'ACCESS_DENIED');
  assert.equal(mapToolError('Please wait... _wafchallengeid slardar_us_waf').code, 'BOT_CHECK');
  assert.equal(mapToolError('This video is not available in your country').code, 'GEO_BLOCKED');
  assert.equal(mapToolError('Does not pass filter !is_live & duration <= 7200').code, 'TOO_LONG');
});
