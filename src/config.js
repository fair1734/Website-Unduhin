const path = require('node:path');
const fs = require('node:fs');

const rootDir = path.resolve(__dirname, '..');

function intEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const port = intEnv('PORT', 3000, 1, 65535);

module.exports = {
  rootDir,
  port,
  host: process.env.HOST || '0.0.0.0',
  siteAddress: process.env.SITE_ADDRESS || `http://localhost:${port}`,
  tmpDir: path.resolve(process.env.TMP_DIR || path.join(rootDir, 'tmp')),
  cookiesFile: path.resolve(process.env.COOKIES_FILE || path.join(rootDir, 'cookies', 'cookies.txt')),
  ytdlpPath: process.env.YTDLP_PATH || (
  fs.existsSync(path.join(rootDir, 'bin', 'yt-dlp'))
    ? path.join(rootDir, 'bin', 'yt-dlp')
    : 'yt-dlp'
),
  galleryDlPath: process.env.GALLERY_DL_PATH || 'python3',
galleryDlArgs: [
  '-m',
  'gallery_dl',
],
  maxConcurrent: intEnv('MAX_CONCURRENT', 2, 1, 6),
  maxQueue: intEnv('MAX_QUEUE', 12, 1, 100),
  jobTtlMs: intEnv('JOB_TTL_MIN', 60, 5, 1440) * 60000,
  maxFilesizeMb: intEnv('MAX_FILESIZE_MB', 500, 10, 4096),
  maxDurationSeconds: intEnv('MAX_DURATION_MIN', 120, 1, 600) * 60,
  maxPhotos: intEnv('MAX_PHOTOS', 40, 1, 100),
  minFreeDiskMb: intEnv('MIN_FREE_DISK_MB', 2048, 50, 10000),
  allowAllSites: process.env.ALLOW_ALL_SITES === 'true',
  potBaseUrl: process.env.YTDLP_POT_BASE_URL || '',
  ytdlpExtraArgs: (process.env.YTDLP_EXTRA_ARGS || '').split(/\s+/).filter(Boolean),
  rateLimitWindowMs: intEnv('RATE_LIMIT_WINDOW_MIN', 10, 1, 1440) * 60000,
  rateLimitMax: intEnv('RATE_LIMIT_MAX', 40, 5, 1000),
  resolveTimeoutMs: intEnv('RESOLVE_TIMEOUT_SEC', 45, 10, 180) * 1000,
  downloadTimeoutMs: intEnv('DOWNLOAD_TIMEOUT_MIN', 30, 5, 180) * 60000,
  photoTimeoutMs: intEnv('PHOTO_TIMEOUT_SEC', 120, 20, 600) * 1000
};
