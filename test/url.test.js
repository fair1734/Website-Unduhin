const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeInput,
  isAllowedHost,
  isPrivateIp,
  platformForHost,
  isPhotoFirstUrl,
  isPhotoCapablePlatform
} = require('../src/lib/url');

test('menambahkan skema https pada tautan tanpa skema', () => {
  assert.equal(normalizeInput('tiktok.com/@unduhin/video/123').href, 'https://tiktok.com/@unduhin/video/123');
});

test('hanya menerima domain platform yang diizinkan', () => {
  assert.equal(isAllowedHost('www.tiktok.com'), true);
  assert.equal(isAllowedHost('youtu.be'), true);
  assert.equal(isAllowedHost('tiktok.com.contoh.com'), false);
  assert.equal(isAllowedHost('contoh.com'), false);
});

test('menolak tautan berbahaya dan alamat privat', () => {
  assert.throws(() => normalizeInput('http://127.0.0.1/video'), { code: 'PRIVATE_ADDRESS' });
  assert.throws(() => normalizeInput('http://localhost:3000/video'), { code: 'INVALID_URL' });
  assert.throws(() => normalizeInput('https://example.com/video'), { code: 'DOMAIN_NOT_ALLOWED' });
  assert.throws(() => normalizeInput('javascript:alert(1)'), { code: 'INVALID_URL' });
  assert.throws(() => normalizeInput('https://user:pass@tiktok.com/video/1'), { code: 'INVALID_URL' });
  assert.throws(() => normalizeInput('https://www.tiktok.com:8080/video/1'), { code: 'INVALID_URL' });
});

test('mengenali alamat IP privat termasuk IPv6 terpetakan', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.1.2.3'), true);
  assert.equal(isPrivateIp('172.20.0.1'), true);
  assert.equal(isPrivateIp('192.168.0.2'), true);
  assert.equal(isPrivateIp('169.254.1.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('fd00::1'), true);
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIp('::ffff:7f00:1'), true);
});

test('mendeteksi platform dan tautan foto', () => {
  assert.equal(platformForHost('www.tiktok.com'), 'TikTok');
  assert.equal(platformForHost('youtube.com'), 'YouTube');
  assert.equal(platformForHost('x.com'), 'X');
  assert.equal(platformForHost('instagram.com'), 'Instagram');

  const tiktok = normalizeInput('https://www.tiktok.com/@unduhin/photo/123');
  assert.equal(isPhotoFirstUrl(tiktok, 'TikTok'), true);
  assert.equal(isPhotoFirstUrl(normalizeInput('https://www.tiktok.com/@unduhin/video/123'), 'TikTok'), false);

  const instagram = normalizeInput('https://www.instagram.com/p/abc123/');
  assert.equal(isPhotoFirstUrl(instagram, 'Instagram'), true);
  assert.equal(isPhotoCapablePlatform('Instagram'), true);
  assert.equal(isPhotoCapablePlatform('YouTube'), false);
});
