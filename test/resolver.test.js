const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const resolver = require('../src/services/resolver');
const ytdlp = require('../src/services/ytdlp');
const tiktok = require('../src/services/tiktok');
const { AppError } = require('../src/lib/errors');

const PHOTO_URL = 'https://www.tiktok.com/@pengguna/photo/123';
const SLIDESHOW_URL = 'https://www.tiktok.com/@pengguna/video/456';

function mockDns(t) {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
}

function photoPost() {
  return {
    id: '123',
    title: 'Foto TikTok',
    uploader: 'pengguna',
    thumbnail: 'https://p16-common-sign.tiktokcdn.com/foto-1.jpeg',
    photoCount: 7,
    maxSelectable: 7,
    photos: Array.from({ length: 7 }, (_, offset) => ({
      index: offset + 1,
      previewUrl: `https://p16-common-sign.tiktokcdn.com/foto-${offset + 1}.jpeg`,
      urls: [`https://p16-common-sign.tiktokcdn.com/foto-${offset + 1}.jpeg`],
      width: 1080,
      height: 1920
    }))
  };
}

function audioInfo() {
  return {
    title: 'Slideshow',
    uploader: 'pengguna',
    duration: 10,
    webpage_url: SLIDESHOW_URL,
    formats: [{
      format_id: 'audio',
      ext: 'm4a',
      vcodec: 'none',
      acodec: 'mp4a',
      url: 'https://example.invalid/audio.m4a'
    }]
  };
}

function videoInfo() {
  return {
    title: 'Video TikTok',
    uploader: 'pengguna',
    duration: 15,
    webpage_url: SLIDESHOW_URL,
    formats: [{
      format_id: 'video',
      height: 720,
      width: 1280,
      ext: 'mp4',
      vcodec: 'avc1',
      acodec: 'mp4a',
      url: 'https://example.invalid/video.mp4'
    }]
  };
}

test('TikTok /photo/ langsung memakai embed, bukan yt-dlp', async (t) => {
  mockDns(t);
  const getInfo = t.mock.method(ytdlp, 'getInfo', async () => {
    throw new Error('yt-dlp tidak boleh dipanggil');
  });
  t.mock.method(tiktok, 'getPhotoPost', async () => photoPost());

  const result = await resolver.resolve(PHOTO_URL);
  assert.equal(result.kind, 'photo');
  assert.equal(result.photoCount, 7);
  assert.equal(result.photos.length, 7);
  assert.equal(getInfo.mock.callCount(), 0);
});

test('TikTok /video/ yang hanya audio diubah menjadi foto jika embed berisi foto', async (t) => {
  mockDns(t);
  t.mock.method(ytdlp, 'getInfo', async () => audioInfo());
  const tryPhoto = t.mock.method(tiktok, 'tryGetPhotoPost', async () => photoPost());

  const result = await resolver.resolve(SLIDESHOW_URL);
  assert.equal(result.kind, 'photo');
  assert.equal(result.photoCount, 7);
  assert.equal(tryPhoto.mock.callCount(), 1);
});

test('video TikTok normal tetap menjadi video', async (t) => {
  mockDns(t);
  t.mock.method(ytdlp, 'getInfo', async () => videoInfo());
  const tryPhoto = t.mock.method(tiktok, 'tryGetPhotoPost', async () => photoPost());

  const result = await resolver.resolve(SLIDESHOW_URL);
  assert.equal(result.kind, 'video');
  assert.equal(result.qualities[0].height, 720);
  assert.equal(tryPhoto.mock.callCount(), 0);
});

test('kegagalan yt-dlp TikTok dicoba lewat embed foto', async (t) => {
  mockDns(t);
  t.mock.method(ytdlp, 'getInfo', async () => {
    throw new AppError('UNSUPPORTED', 'Tidak didukung', 422);
  });
  t.mock.method(tiktok, 'tryGetPhotoPost', async () => photoPost());

  const result = await resolver.resolve(SLIDESHOW_URL);
  assert.equal(result.kind, 'photo');
  assert.equal(result.photoCount, 7);
});

test('audio TikTok tetap tersedia jika embed bukan postingan foto', async (t) => {
  mockDns(t);
  t.mock.method(ytdlp, 'getInfo', async () => audioInfo());
  t.mock.method(tiktok, 'tryGetPhotoPost', async () => null);

  const result = await resolver.resolve(SLIDESHOW_URL);
  assert.equal(result.kind, 'audio');
});

test('WAF TikTok menjadi error BOT_CHECK, bukan foto kosong', async (t) => {
  mockDns(t);
  t.mock.method(tiktok, 'getPhotoPost', async () => {
    throw new AppError('BOT_CHECK', 'TikTok meminta verifikasi bot.', 502);
  });

  await assert.rejects(resolver.resolve(PHOTO_URL), { code: 'BOT_CHECK' });
});
