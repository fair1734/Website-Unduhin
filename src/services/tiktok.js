const fsp = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');
const { AppError, mapToolError } = require('../lib/errors');
const { parseSelection } = require('../lib/selection');
const { normalizeInput, assertPublicHost } = require('../lib/url');
const { pickText } = require('../lib/format');

const EMBED_HOST = 'www.tiktok.com';
const EMBED_TIMEOUT_MS = 20000;
const MAX_EMBED_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const CDN_SUFFIXES = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokcdn-va.com',
  'tiktokv.com',
  'ibytedtos.com',
  'byteoversea.com'
];
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
  ['image/heic', '.heic']
]);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic']);

function failure(code, message, status = 502) {
  return new AppError(code, message, status);
}

function isTimeout(error, signal) {
  return error?.name === 'TimeoutError'
    || error?.code === 'ETIMEDOUT'
    || signal?.reason?.name === 'TimeoutError';
}

function isAbort(error, signal) {
  if (isTimeout(error, signal)) return false;
  return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function requestError(error, signal, message = 'Tidak bisa mengambil data dari TikTok. Coba lagi.') {
  if (isTimeout(error, signal)) return failure('TIMEOUT', 'Pengambilan foto terlalu lama. Coba lagi.', 504);
  if (isAbort(error, signal)) return failure('CANCELLED', 'Unduhan dibatalkan.', 499);
  return failure('PROCESSING_FAILED', message);
}

function operationSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function hostMatches(hostname, suffix) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === suffix || host.endsWith(`.${suffix}`);
}

function isTikTokHost(hostname) {
  return hostMatches(hostname, 'tiktok.com');
}

function isTikTokCdnHost(hostname) {
  return CDN_SUFFIXES.some((suffix) => hostMatches(hostname, suffix));
}

function extractVideoId(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    return null;
  }

  const patterns = [
    /\/@[^/]+\/(?:photo|video)\/(\d+)/i,
    /\/embed\/v2\/(\d+)/i,
    /\/v\/(\d+)\.html/i,
    /\/t\/(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(url.pathname);
    if (match) return match[1];
  }

  const queryId = url.searchParams.get('item_id') || url.searchParams.get('video_id');
  return queryId && /^\d+$/.test(queryId) ? queryId : null;
}

async function readText(response, maxBytes = MAX_EMBED_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw failure('PROCESSING_FAILED', 'Respons TikTok terlalu besar untuk diproses.');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    throw failure('PROCESSING_FAILED', 'Respons TikTok terlalu besar untuk diproses.');
  }
  return text;
}

async function requestEmbed(id, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const signal = operationSignal(options.signal, options.timeoutMs || EMBED_TIMEOUT_MS);
  const embedUrl = `https://${EMBED_HOST}/embed/v2/${id}`;

  let response;
  try {
    response = await fetchImpl(embedUrl, {
      signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
  } catch (error) {
    throw requestError(error, options.signal, 'Tidak bisa mengambil halaman foto TikTok. Coba lagi.');
  }

  if (!response.ok) {
    let text = '';
    try {
      text = await readText(response, 256 * 1024);
    } catch {
    }
    if (response.status === 404 || response.status === 410) {
      throw failure('UNAVAILABLE', 'Postingan TikTok tidak tersedia, privat, atau sudah dihapus.', 422);
    }
    if (response.status === 429) {
      throw failure('RATE_LIMITED', 'TikTok membatasi permintaan. Coba lagi beberapa saat lagi.', 429);
    }
    const mapped = mapToolError(text);
    if (mapped.code !== 'PROCESSING_FAILED') throw mapped;
    throw failure('PROCESSING_FAILED', `TikTok menolak permintaan foto (HTTP ${response.status}). Coba lagi.`);
  }

  let html;
  try {
    html = await readText(response);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw requestError(error, options.signal, 'Tidak bisa membaca halaman foto TikTok.');
  }
  return html;
}

function parseEmbedHtml(html, id) {
  const source = String(html || '');
  const match = /<script[^>]*\bid=["']__FRONTITY_CONNECT_STATE__["'][^>]*>([\s\S]*?)<\/script>/i.exec(source);
  if (!match) {
    if (/slardar|_wafchallengeid|captcha|waf challenge|verify you are human/i.test(source)) {
      throw failure('BOT_CHECK', 'TikTok meminta verifikasi bot. Coba lagi nanti.', 502);
    }
    throw failure('PROCESSING_FAILED', 'Struktur halaman TikTok tidak dikenali. Coba lagi nanti.');
  }

  let state;
  try {
    state = JSON.parse(match[1]);
  } catch {
    throw failure('PROCESSING_FAILED', 'Data halaman TikTok tidak bisa dibaca.');
  }

  const routes = state?.source?.data && typeof state.source.data === 'object'
    ? state.source.data
    : {};
  const routeKey = `/embed/v2/${id}`;
  let node = routes[routeKey];
  if (!node) {
    node = Object.values(routes).find((value) => value && typeof value === 'object' && value.videoData);
  }
  if (!node) {
    throw failure('PROCESSING_FAILED', 'Data postingan TikTok tidak ditemukan.');
  }
  if (node.isError) {
    throw failure('UNAVAILABLE', 'Postingan TikTok tidak tersedia, privat, atau sudah dihapus.', 422);
  }

  const videoData = node.videoData || {};
  const images = Array.isArray(videoData.imagePostInfo?.displayImages)
    ? videoData.imagePostInfo.displayImages
    : [];
  if (images.length === 0) return null;

  const photos = [];
  for (const image of images) {
    const urls = Array.isArray(image?.urlList)
      ? image.urlList.filter((value) => typeof value === 'string' && /^https:\/\//i.test(value))
      : [];
    if (urls.length === 0) continue;
    const width = Number(image.width);
    const height = Number(image.height);
    photos.push({
      index: photos.length + 1,
      previewUrl: urls[0],
      urls,
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : 0
    });
  }
  if (photos.length === 0) return null;

  const author = videoData.authorInfos || {};
  const item = videoData.itemInfos || {};
  const covers = Array.isArray(item.covers) ? item.covers : [];
  const thumbnail = photos[0].previewUrl
    || (typeof covers[0] === 'string' ? covers[0] : null);

  return {
    id: String(id),
    title: pickText(item.text, 'TikTok media'),
    uploader: pickText(author.uniqueId, author.nickName, ''),
    thumbnail,
    photos,
    photoCount: photos.length,
    maxSelectable: Math.min(photos.length, config.maxPhotos)
  };
}

async function resolveShortLink(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let current = new URL(url.href);
  let validate = options.validateHost !== false;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const directId = extractVideoId(current);
    if (directId) return directId;
    if (!isTikTokHost(current.hostname)) {
      throw failure('UNSUPPORTED', 'Tautan TikTok mengarah ke domain yang tidak didukung.', 422);
    }

    const signal = operationSignal(options.signal, options.timeoutMs || EMBED_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(current.href, {
        method: 'HEAD',
        signal,
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT }
      });
    } catch (error) {
      throw requestError(error, options.signal, 'Tidak bisa membuka tautan pendek TikTok.');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      let next;
      try {
        next = normalizeInput(new URL(location, current).href);
      } catch (error) {
        throw error instanceof AppError ? error : failure('UNSUPPORTED', 'Tautan pendek TikTok tidak valid.', 422);
      }
      if (!isTikTokHost(next.hostname)) {
        throw failure('UNSUPPORTED', 'Tautan pendek TikTok mengarah ke domain yang tidak didukung.', 422);
      }
      if (validate) await assertPublicHost(next);
      current = next;
      continue;
    }

    if (response.ok) {
      const fromUrl = extractVideoId(response.url) || extractVideoId(current);
      if (fromUrl) return fromUrl;
      break;
    }

    if (response.status === 404 || response.status === 410) {
      throw failure('UNAVAILABLE', 'Postingan TikTok tidak tersedia atau sudah dihapus.', 422);
    }
    break;
  }

  throw failure('UNSUPPORTED', 'Tautan TikTok tidak mengarah ke postingan foto atau video.', 422);
}

async function resolveVideoId(url, options = {}) {
  const direct = extractVideoId(url);
  if (direct) return direct;
  const normalized = normalizeInput(url.href || String(url));
  return resolveShortLink(normalized, options);
}

async function fetchPhotoPost(url, options = {}) {
  const id = await resolveVideoId(url, options);
  const html = await requestEmbed(id, options);
  const post = parseEmbedHtml(html, id);
  if (!post) return null;
  return { ...post, webpageUrl: url.href || String(url) };
}

async function getPhotoPost(url, options = {}) {
  const post = await fetchPhotoPost(url, options);
  if (!post) {
    throw failure('NO_MEDIA', 'Tidak ada foto yang ditemukan pada postingan TikTok ini.', 422);
  }
  return post;
}

async function tryGetPhotoPost(url, options = {}) {
  return fetchPhotoPost(url, options);
}

function publicPhotoPost(post) {
  return {
    photoCount: post.photoCount,
    maxSelectable: post.maxSelectable,
    photos: post.photos.map((photo) => ({
      index: photo.index,
      previewUrl: photo.previewUrl,
      width: photo.width,
      height: photo.height
    }))
  };
}

function imageExtension(contentType, url) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (IMAGE_TYPES.has(type)) return IMAGE_TYPES.get(type);
  if (type && type !== 'application/octet-stream') {
    throw failure('PROCESSING_FAILED', 'TikTok mengembalikan file yang bukan gambar.');
  }
  let ext = '';
  try {
    ext = path.extname(new URL(url).pathname).toLowerCase();
  } catch {
  }
  if (ext === '.jpeg') ext = '.jpg';
  return IMAGE_EXTENSIONS.has(ext) ? ext : '.jpg';
}

function validateImageUrl(rawUrl, options = {}) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw failure('PROCESSING_FAILED', 'URL foto TikTok tidak valid.');
  }
  if (target.protocol !== 'https:' || target.username || target.password) {
    throw failure('PROCESSING_FAILED', 'URL foto TikTok tidak valid.');
  }
  if (target.port && target.port !== '443') {
    throw failure('PROCESSING_FAILED', 'URL foto TikTok tidak valid.');
  }
  if (!isTikTokCdnHost(target.hostname)) {
    throw failure('PROCESSING_FAILED', 'URL foto TikTok mengarah ke host yang tidak diizinkan.');
  }
  return target;
}

async function downloadImage({ rawUrl, finalPath, signal, fetchImpl, validateHost, remainingBytes, maxFileBytes }) {
  let target = validateImageUrl(rawUrl);
  if (validateHost) await assertPublicHost(target);

  let response;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    try {
      response = await fetchImpl(target.href, {
        signal,
        redirect: 'manual',
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://www.tiktok.com/',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
      });
    } catch (error) {
      throw requestError(error, signal, 'Tidak bisa mengunduh foto TikTok. Coba lagi.');
    }

    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location) {
      throw failure('PROCESSING_FAILED', 'TikTok mengirim redirect foto yang tidak valid.');
    }
    target = validateImageUrl(new URL(location, target).href);
    if (validateHost) await assertPublicHost(target);
  }

  if (response.status >= 300 && response.status < 400) {
    throw failure('PROCESSING_FAILED', 'Terlalu banyak redirect saat mengunduh foto TikTok.');
  }

  if (response.status === 403 || response.status === 401) {
    throw failure('ACCESS_DENIED', 'URL foto TikTok sudah kedaluwarsa atau ditolak. Muat ulang tautan lalu coba lagi.', 403);
  }
  if (response.status === 404 || response.status === 410) {
    throw failure('UNAVAILABLE', 'Salah satu foto TikTok sudah tidak tersedia.', 422);
  }
  if (response.status === 429) {
    throw failure('RATE_LIMITED', 'TikTok membatasi unduhan foto. Coba lagi beberapa saat lagi.', 429);
  }
  if (!response.ok) {
    throw failure('PROCESSING_FAILED', `TikTok gagal mengirim foto (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get('content-type');
  const ext = imageExtension(contentType, target.href);
  const final = `${finalPath}${ext}`;
  const declared = Number(response.headers.get('content-length'));
  const maxAllowed = Math.min(maxFileBytes, remainingBytes);
  if (Number.isFinite(declared) && declared > maxAllowed) {
    throw failure(
      'TOO_LARGE',
      `Salah satu foto melebihi batas ukuran ${config.maxFilesizeMb} MB atau sisa kuota unduhan.`,
      413
    );
  }
  if (!response.body) {
    throw failure('PROCESSING_FAILED', 'TikTok mengirim foto kosong.');
  }

  const part = `${final}.part`;
  let handle;
  let size = 0;
  try {
    handle = await fsp.open(part, 'w');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxAllowed) {
        throw failure(
          'TOO_LARGE',
          `Total ukuran foto melebihi batas ${config.maxFilesizeMb} MB. Pilih lebih sedikit foto.`,
          413
        );
      }
      await handle.write(chunk);
    }
    await handle.close();
    handle = null;
    if (size === 0) {
      throw failure('PROCESSING_FAILED', 'TikTok mengirim foto kosong.');
    }
    await fsp.rename(part, final);
    return { path: final, name: path.basename(final), size, isImage: true, isVideo: false, isAudio: false };
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fsp.rm(part, { force: true }).catch(() => {});
    throw error;
  }
}

async function downloadSelected({ post, indices, jobDir, signal, onProgress, fetchImpl, validateHost }) {
  const maxPhotos = config.maxPhotos;
  const maxBytes = config.maxFilesizeMb * 1024 * 1024;
  if ((indices === null || indices === undefined) && post.photoCount > maxPhotos) {
    throw failure(
      'TOO_MANY_PHOTOS',
      `Postingan ini memiliki ${post.photoCount} foto, sedangkan batas server ${maxPhotos}. Pilih maksimal ${maxPhotos} foto.`,
      400
    );
  }

  const selected = indices === null || indices === undefined
    ? post.photos.map((photo) => photo.index)
    : parseSelection(indices, { max: Math.min(post.photoCount, maxPhotos) });
  if (selected.length > maxPhotos) {
    throw failure('TOO_MANY_PHOTOS', `Maksimal ${maxPhotos} foto per unduhan.`, 400);
  }

  const startedAt = Date.now();
  let downloadedBytes = 0;
  const files = [];
  if (onProgress) {
    onProgress({
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      eta: 0,
      filesDone: 0,
      filesTotal: selected.length
    });
  }

  for (let offset = 0; offset < selected.length; offset++) {
    const index = selected[offset];
    const photo = post.photos[index - 1];
    if (!photo) {
      throw failure(
        'INVALID_PHOTO_SELECTION',
        `Foto nomor ${index} tidak tersedia. Postingan ini hanya memiliki ${post.photoCount} foto.`,
        400
      );
    }

    let lastError = null;
    let file = null;
    for (const rawUrl of photo.urls) {
      try {
        file = await downloadImage({
          rawUrl,
          finalPath: path.join(jobDir, `${String(index).padStart(3, '0')}_foto`),
          signal,
          fetchImpl: fetchImpl || globalThis.fetch,
          validateHost: validateHost !== false,
          remainingBytes: maxBytes - downloadedBytes,
          maxFileBytes: maxBytes
        });
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof AppError && ['CANCELLED', 'TIMEOUT', 'TOO_LARGE'].includes(error.code)) {
          throw error;
        }
      }
    }

    if (!file) {
      throw lastError || failure('PROCESSING_FAILED', `Foto nomor ${index} gagal diunduh.`);
    }

    files.push(file);
    downloadedBytes += file.size;
    const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
    if (onProgress) {
      onProgress({
        percent: (offset + 1) / selected.length * 100,
        downloadedBytes,
        totalBytes: 0,
        speed: Math.round(downloadedBytes / elapsed),
        eta: 0,
        filesDone: offset + 1,
        filesTotal: selected.length,
        currentFile: index
      });
    }
  }

  return files;
}

async function downloadPhotos({ url, post, photoIndices, jobDir, signal, onProgress, fetchImpl, validateHost }) {
  const timeoutMs = config.photoTimeoutMs;
  const overallSignal = operationSignal(signal, timeoutMs);

  let resolved = post;
  if (!resolved) {
    resolved = await getPhotoPost(url, {
      signal: overallSignal,
      fetchImpl,
      validateHost,
      timeoutMs
    });
  }

  try {
    return await downloadSelected({
      post: resolved,
      indices: photoIndices,
      jobDir,
      signal: overallSignal,
      onProgress,
      fetchImpl,
      validateHost
    });
  } catch (error) {
    if (isTimeout(error, overallSignal)) {
      throw failure('TIMEOUT', 'Pengambilan foto terlalu lama. Coba lagi.', 504);
    }
    if (isAbort(error, overallSignal)) {
      throw failure('CANCELLED', 'Unduhan dibatalkan.', 499);
    }
    throw error;
  }
}

module.exports = {
  extractVideoId,
  resolveVideoId,
  parseEmbedHtml,
  fetchPhotoPost,
  getPhotoPost,
  tryGetPhotoPost,
  publicPhotoPost,
  downloadPhotos,
  isTikTokCdnHost,
  isTikTokHost
};
