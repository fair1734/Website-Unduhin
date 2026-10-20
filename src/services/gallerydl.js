const fs = require('node:fs');
const config = require('../config');
const { AppError, mapToolError } = require('../lib/errors');
const { runCommand } = require('../lib/process');
const { listMediaFiles } = require('../lib/files');
const { platformForHost } = require('../lib/url');
const tiktok = require('./tiktok');

let versionCache = { value: null, checkedAt: 0 };

function commonArgs() {
  const args = ['--config-ignore', '--no-mtime', '--http-timeout', '20', '-R', '2'];
  if (fs.existsSync(config.cookiesFile)) {
    args.push('-C', config.cookiesFile);
  }
  return args;
}

function toolFailure(result) {
  if (result.aborted) return new AppError('CANCELLED', 'Unduhan dibatalkan.', 499);
  if (result.timedOut) return new AppError('TIMEOUT', 'Pengambilan foto terlalu lama. Coba lagi.', 504);
  if (result.outputLimitExceeded) return new AppError('PROCESSING_FAILED', 'Respons platform terlalu besar untuk diproses.', 502);
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  if (process.env.DEBUG_TOOLS === 'true') console.error(output);
  return mapToolError(output);
}

async function downloadPhotos({ url, jobDir, signal, platform, photoIndices, post, onProgress }) {
  let resolvedPlatform = platform;
  if (!resolvedPlatform) {
    try {
      resolvedPlatform = platformForHost(new URL(url).hostname);
    } catch {
      resolvedPlatform = 'Lainnya';
    }
  }

  if (resolvedPlatform === 'TikTok') {
    return tiktok.downloadPhotos({
      url,
      post,
      jobDir,
      signal,
      photoIndices,
      onProgress
    });
  }

  if (photoIndices !== null && photoIndices !== undefined) {
    throw new AppError(
      'INVALID_PHOTO_SELECTION',
      'Pemilihan foto saat ini hanya tersedia untuk TikTok.',
      400
    );
  }

  const args = [
    ...commonArgs(),
    '-D', jobDir,
    '-f', '{num:03d}_{filename}.{extension}',
    '--range', `1-${config.maxPhotos}`,
    '--filesize-max', `${config.maxFilesizeMb}M`,
    url
  ];

  let result;
  try {
    result = await runCommand(config.galleryDlPath, args, {
      timeoutMs: config.photoTimeoutMs,
      signal,
      maxOutputBytes: 8 * 1024 * 1024
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new AppError('TOOL_MISSING', 'gallery-dl belum terpasang di server.', 503);
    }
    throw new AppError('PROCESSING_FAILED', 'Gagal menjalankan pengambil foto.', 502);
  }

  const files = await listMediaFiles(jobDir);
  if (result.code !== 0 && files.length === 0) {
    throw toolFailure(result);
  }
  if (files.length === 0) {
    throw new AppError('NO_MEDIA', 'Tidak ada foto atau media yang ditemukan pada tautan ini.', 422);
  }

  const limited = files.slice(0, config.maxPhotos);
  const totalSize = limited.reduce((total, file) => total + file.size, 0);
  if (totalSize > config.maxFilesizeMb * 1024 * 1024) {
    throw new AppError('TOO_LARGE', 'Total ukuran foto melebihi batas server.', 413);
  }

  return limited;
}

async function getVersion() {
  if (versionCache.value && Date.now() - versionCache.checkedAt < 5 * 60 * 1000) {
    return versionCache.value;
  }

  try {
    const result = await runCommand(config.galleryDlPath, ['--version'], { timeoutMs: 8000, maxOutputBytes: 65536 });
    versionCache = {
      value: result.code === 0 ? result.stdout.trim().split('\n')[0] : null,
      checkedAt: Date.now()
    };
  } catch {
    versionCache = { value: null, checkedAt: Date.now() };
  }

  return versionCache.value;
}

module.exports = { downloadPhotos, getVersion };
