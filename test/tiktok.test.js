const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const config = require('../src/config');
const tiktok = require('../src/services/tiktok');

const CDN = 'p16-common-sign.tiktokcdn.com';

function makePost(count) {
  return {
    id: '123',
    title: 'Postingan uji',
    uploader: 'pengguna',
    thumbnail: `https://${CDN}/foto-1.jpeg`,
    photoCount: count,
    maxSelectable: Math.min(count, config.maxPhotos),
    photos: Array.from({ length: count }, (_, offset) => ({
      index: offset + 1,
      previewUrl: `https://${CDN}/foto-${offset + 1}.jpeg`,
      urls: [
        `https://${CDN}/foto-${offset + 1}.jpeg`,
        `https://p19-common-sign.tiktokcdn.com/foto-${offset + 1}.jpeg`
      ],
      width: 1080,
      height: 1920
    }))
  };
}

function embedHtml(count = 2) {
  const images = Array.from({ length: count }, (_, offset) => ({
    width: 1080,
    height: 1920,
    urlList: [
      `https://${CDN}/foto-${offset + 1}.jpeg`,
      `https://p19-common-sign.tiktokcdn.com/foto-${offset + 1}.jpeg`
    ]
  }));
  const state = {
    source: {
      data: {
        '/embed/v2/123': {
          isError: false,
          videoData: {
            itemInfos: {
              text: 'Caption TikTok',
              covers: [`https://${CDN}/cover.jpeg`]
            },
            authorInfos: { uniqueId: 'pengguna', nickName: 'Pengguna' },
            imagePostInfo: { displayImages: images }
          }
        }
      }
    }
  };
  return `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify(state)}</script></html>`;
}

function imageResponse(url) {
  const match = /foto-(\d+)\.jpeg/.exec(String(url));
  const number = match ? match[1] : '0';
  return new Response(Buffer.from(`image-${number}`), {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(Buffer.byteLength(`image-${number}`))
    }
  });
}

async function tempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'unduhin-tiktok-test-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('membaca embed foto, metadata, dan dimensi', () => {
  const post = tiktok.parseEmbedHtml(embedHtml(2), '123');
  assert.equal(post.photoCount, 2);
  assert.equal(post.title, 'Caption TikTok');
  assert.equal(post.uploader, 'pengguna');
  assert.equal(post.photos[0].index, 1);
  assert.equal(post.photos[0].width, 1080);
  assert.equal(post.photos[0].height, 1920);
  assert.match(post.photos[0].previewUrl, /foto-1\.jpeg$/);
});

test('membaca satu foto dan sepuluh foto', () => {
  assert.equal(tiktok.parseEmbedHtml(embedHtml(1), '123').photoCount, 1);
  assert.equal(tiktok.parseEmbedHtml(embedHtml(10), '123').photoCount, 10);
});

test('mengembalikan null untuk video biasa tanpa foto', () => {
  const state = {
    source: {
      data: {
        '/embed/v2/123': {
          videoData: {
            itemInfos: { text: 'Video biasa' },
            authorInfos: { uniqueId: 'pengguna' }
          }
        }
      }
    }
  };
  const html = `<script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify(state)}</script>`;
  assert.equal(tiktok.parseEmbedHtml(html, '123'), null);
});

test('mendeteksi halaman WAF dan JSON rusak', () => {
  assert.throws(
    () => tiktok.parseEmbedHtml('<html>Please wait... _wafchallengeid slardar_us_waf</html>', '123'),
    { code: 'BOT_CHECK' }
  );
  assert.throws(
    () => tiktok.parseEmbedHtml('<script id="__FRONTITY_CONNECT_STATE__" type="application/json">{rusak</script>', '123'),
    { code: 'PROCESSING_FAILED' }
  );
});

test('mengunduh hanya foto yang dipilih dan mempertahankan nomor asli', async (t) => {
  const dir = await tempDir(t);
  const requested = [];
  const fetchImpl = async (url, options) => {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    requested.push(String(url));
    return imageResponse(url);
  };

  const files = await tiktok.downloadPhotos({
    url: 'https://www.tiktok.com/@pengguna/photo/123',
    post: makePost(7),
    photoIndices: [1, 3, 5],
    jobDir: dir,
    fetchImpl,
    validateHost: false
  });

  assert.deepEqual(files.map((file) => file.name), ['001_foto.jpg', '003_foto.jpg', '005_foto.jpg']);
  assert.deepEqual(requested, [
    `https://${CDN}/foto-1.jpeg`,
    `https://${CDN}/foto-3.jpeg`,
    `https://${CDN}/foto-5.jpeg`
  ]);
  assert.deepEqual((await fsp.readdir(dir)).sort(), ['001_foto.jpg', '003_foto.jpg', '005_foto.jpg']);
  assert.equal(await fsp.readFile(path.join(dir, '003_foto.jpg'), 'utf8'), 'image-3');
});

test('mengunduh satu foto dan semua foto', async (t) => {
  const oneDir = await tempDir(t);
  const one = await tiktok.downloadPhotos({
    url: 'https://www.tiktok.com/@pengguna/photo/123',
    post: makePost(1),
    photoIndices: null,
    jobDir: oneDir,
    fetchImpl: async (url) => imageResponse(url),
    validateHost: false
  });
  assert.deepEqual(one.map((file) => file.name), ['001_foto.jpg']);

  const tenDir = await tempDir(t);
  const ten = await tiktok.downloadPhotos({
    url: 'https://www.tiktok.com/@pengguna/photo/123',
    post: makePost(10),
    photoIndices: null,
    jobDir: tenDir,
    fetchImpl: async (url) => imageResponse(url),
    validateHost: false
  });
  assert.equal(ten.length, 10);
  assert.equal(ten[9].name, '010_foto.jpg');
});

test('menolak indeks foto yang tidak tersedia tanpa mengunduh', async (t) => {
  const dir = await tempDir(t);
  let calls = 0;
  await assert.rejects(
    tiktok.downloadPhotos({
      url: 'https://www.tiktok.com/@pengguna/photo/123',
      post: makePost(3),
      photoIndices: [5],
      jobDir: dir,
      fetchImpl: async (url) => {
        calls++;
        return imageResponse(url);
      },
      validateHost: false
    }),
    { code: 'INVALID_PHOTO_SELECTION' }
  );
  assert.equal(calls, 0);
});

test('memetakan 403 CDN dan membatalkan unduhan tanpa file parsial', async (t) => {
  const forbiddenDir = await tempDir(t);
  await assert.rejects(
    tiktok.downloadPhotos({
      url: 'https://www.tiktok.com/@pengguna/photo/123',
      post: makePost(1),
      photoIndices: null,
      jobDir: forbiddenDir,
      fetchImpl: async () => new Response('forbidden', { status: 403 }),
      validateHost: false
    }),
    { code: 'ACCESS_DENIED' }
  );
  assert.deepEqual(await fsp.readdir(forbiddenDir), []);

  const controller = new AbortController();
  controller.abort();
  const cancelDir = await tempDir(t);
  await assert.rejects(
    tiktok.downloadPhotos({
      url: 'https://www.tiktok.com/@pengguna/photo/123',
      post: makePost(1),
      photoIndices: null,
      jobDir: cancelDir,
      signal: controller.signal,
      fetchImpl: async (url, options) => {
        if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return imageResponse(url);
      },
      validateHost: false
    }),
    { code: 'CANCELLED' }
  );
  assert.deepEqual(await fsp.readdir(cancelDir), []);
});

test('memetakan timeout unduhan foto tanpa file parsial', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(
    tiktok.downloadPhotos({
      url: 'https://www.tiktok.com/@pengguna/photo/123',
      post: makePost(1),
      photoIndices: null,
      jobDir: dir,
      fetchImpl: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      validateHost: false
    }),
    { code: 'TIMEOUT' }
  );
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('menolak redirect foto ke host di luar CDN TikTok', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(
    tiktok.downloadPhotos({
      url: 'https://www.tiktok.com/@pengguna/photo/123',
      post: makePost(1),
      photoIndices: null,
      jobDir: dir,
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: 'https://contoh.invalid/foto.jpg' }
      }),
      validateHost: false
    }),
    { code: 'PROCESSING_FAILED' }
  );
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('menolak foto yang melebihi batas ukuran', async (t) => {
  const oldLimit = config.maxFilesizeMb;
  config.maxFilesizeMb = 1;
  t.after(() => { config.maxFilesizeMb = oldLimit; });

  const dir = await tempDir(t);
  const body = Buffer.alloc(2 * 1024 * 1024);
  await assert.rejects(
    tiktok.downloadPhotos({
      url: 'https://www.tiktok.com/@pengguna/photo/123',
      post: makePost(1),
      photoIndices: null,
      jobDir: dir,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(body.length)
        }
      }),
      validateHost: false
    }),
    { code: 'TOO_LARGE' }
  );
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('membaca ID dan mengikuti redirect tautan pendek TikTok', async () => {
  assert.equal(tiktok.extractVideoId('https://www.tiktok.com/@pengguna/photo/123'), '123');
  assert.equal(tiktok.extractVideoId('https://www.tiktok.com/@pengguna/video/456'), '456');

  const fetchImpl = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://www.tiktok.com/@pengguna/photo/789' }
  });
  const id = await tiktok.resolveVideoId('https://vt.tiktok.com/ZSgB5JBJq_/', {
    fetchImpl,
    validateHost: false
  });
  assert.equal(id, '789');
});
