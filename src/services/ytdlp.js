const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { AppError, mapToolError } = require('../lib/errors');
const { runCommand } = require('../lib/process');
const { buildFormatSelector } = require('../lib/format');
const { findMediaFile } = require('../lib/files');

let versionCache = { value: null, checkedAt: 0 };

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function parseProgress(line) {
  if (!String(line).startsWith('PROGRESS ')) return null;
  const parts = String(line).slice(9).trim().split(/\s+/);
  if (parts.length < 3) return null;

  const downloadedBytes = numberOrZero(parts[0]);
  const totalBytes = numberOrZero(parts[1]) || numberOrZero(parts[2]);
  const speed = numberOrZero(parts[3]);
  const eta = numberOrZero(parts[4]);
  const percent = totalBytes > 0 ? Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100)) : null;

  return { downloadedBytes, totalBytes, speed, eta, percent };
}

function commonArgs() {
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-color',
    '--socket-timeout', '20',
    '--retries', '3',
    '--fragment-retries', '3',
    '--js-runtimes', 'node'
  ];

  if (fs.existsSync(config.cookiesFile)) {
    args.push('--cookies', config.cookiesFile);
  }
  if (config.potBaseUrl) {
    args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${config.potBaseUrl}`);
  }
  if (config.ytdlpExtraArgs.length) {
    args.push(...config.ytdlpExtraArgs);
  }
  return args;
}

function toolFailure(result) {
  if (result.aborted) return new AppError('CANCELLED', 'Unduhan dibatalkan.', 499);
  if (result.timedOut) return new AppError('TIMEOUT', 'Pengambilan media terlalu lama. Coba lagi.', 504);
  if (result.outputLimitExceeded) return new AppError('PROCESSING_FAILED', 'Respons platform terlalu besar untuk diproses.', 502);
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  if (process.env.DEBUG_TOOLS === 'true') console.error(output);
  return mapToolError(output);
}

async function getInfo(url, signal) {
  let result;
  try {
    result = await runCommand(
      config.ytdlpPath,
      [...commonArgs(), '--no-playlist', '--dump-single-json', url],
      { timeoutMs: config.resolveTimeoutMs, signal, maxOutputBytes: 48 * 1024 * 1024 }
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new AppError('TOOL_MISSING', 'yt-dlp belum terpasang di server.', 503);
    }
    throw new AppError('PROCESSING_FAILED', 'Gagal menjalankan pengambil media.', 502);
  }

  if (result.code !== 0) {
    throw toolFailure(result);
  }

  const output = result.stdout.trim();
  if (!output) {
    throw new AppError('UNSUPPORTED', 'Tautan tidak menghasilkan data media.', 422);
  }

  try {
    return JSON.parse(output);
  } catch {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(output.slice(start, end + 1));
      } catch {
        throw new AppError('PROCESSING_FAILED', 'Data media dari platform tidak bisa dibaca.', 502);
      }
    }
    throw new AppError('PROCESSING_FAILED', 'Data media dari platform tidak bisa dibaca.', 502);
  }
}

function downloadArgs(url, jobDir, extra) {
  return [
    ...commonArgs(),
    '--no-playlist',
    '--newline',
    '--no-write-thumbnail',
    '--no-write-info-json',
    '--no-write-subs',
    '--concurrent-fragments', '3',
    '--max-filesize', `${config.maxFilesizeMb}M`,
    '--match-filter', `!is_live & duration <=? ${config.maxDurationSeconds}`,
    '--progress-template', 'download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    ...extra,
    '-o', path.join(jobDir, 'media.%(ext)s'),
    url
  ];
}

async function runDownload(args, signal, onProgress) {
  let result;
  try {
    result = await runCommand(config.ytdlpPath, args, {
      timeoutMs: config.downloadTimeoutMs,
      signal,
      onStdoutLine: (line) => {
        const progress = parseProgress(line);
        if (progress && onProgress) onProgress(progress);
      },
      onStderrLine: (line) => {
        const progress = parseProgress(line);
        if (progress && onProgress) onProgress(progress);
      }
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new AppError('TOOL_MISSING', 'yt-dlp belum terpasang di server.', 503);
    }
    throw new AppError('PROCESSING_FAILED', 'Gagal menjalankan unduhan.', 502);
  }

  if (result.code !== 0) {
    throw toolFailure(result);
  }
  return result;
}

async function downloadVideo({ url, height, platform, jobDir, signal, onProgress }) {
  const selector = buildFormatSelector(height, platform);
  const args = downloadArgs(url, jobDir, [
    '-f', selector,
    '-S', 'res,fps,br',
    '--merge-output-format', 'mp4'
  ]);

  await runDownload(args, signal, onProgress);
  const file = await findMediaFile(jobDir, ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'ts', 'flv', 'avi']);
  if (!file) {
    throw new AppError('PROCESSING_FAILED', 'File video tidak ditemukan setelah diunduh.', 502);
  }
  if (file.size > config.maxFilesizeMb * 1024 * 1024) {
    throw new AppError('TOO_LARGE', 'Ukuran file melebihi batas server.', 413);
  }
  return file;
}

async function downloadAudio({ url, jobDir, signal, onProgress }) {
  const args = downloadArgs(url, jobDir, [
    '-f', 'ba/b',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0'
  ]);

  await runDownload(args, signal, onProgress);
  const file = await findMediaFile(jobDir, ['mp3']);
  if (!file) {
    throw new AppError('PROCESSING_FAILED', 'File audio tidak ditemukan setelah dikonversi.', 502);
  }
  if (file.size > config.maxFilesizeMb * 1024 * 1024) {
    throw new AppError('TOO_LARGE', 'Ukuran file melebihi batas server.', 413);
  }
  return file;
}

async function getVersion() {
  if (versionCache.value && Date.now() - versionCache.checkedAt < 5 * 60 * 1000) {
    return versionCache.value;
  }

  try {
    const result = await runCommand(config.ytdlpPath, ['--version'], { timeoutMs: 8000, maxOutputBytes: 65536 });
    versionCache = {
      value: result.code === 0 ? result.stdout.trim().split('\n')[0] : null,
      checkedAt: Date.now()
    };
  } catch {
    versionCache = { value: null, checkedAt: Date.now() };
  }

  return versionCache.value;
}

module.exports = {
  getInfo,
  downloadVideo,
  downloadAudio,
  getVersion,
  parseProgress
};
