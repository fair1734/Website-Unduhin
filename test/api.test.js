const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const app = require('../src/app');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('menyajikan halaman beranda dan header keamanan', async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.ok(response.headers.get('content-security-policy'));
  assert.match(html, /Unduhin/);
});

test('mengembalikan JSON 404 untuk endpoint API yang tidak ada', async () => {
  const response = await fetch(`${baseUrl}/api/tidak-ada`);
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.error.code, 'NOT_FOUND');
});

test('menolak domain di luar daftar tanpa melakukan permintaan jaringan', async () => {
  const response = await fetch(`${baseUrl}/api/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/video' })
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'DOMAIN_NOT_ALLOWED');
});

test('menolak body tanpa URL', async () => {
  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'INVALID_URL');
});
