const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.ts', '.flv', '.avi']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.opus', '.ogg', '.wav', '.flac']);
const BLOCKED_EXTENSIONS = new Set(['.part', '.ytdl', '.json', '.txt', '.zip', '.tmp']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.zip': 'application/zip'
};

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function removeDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

function sanitizeFilename(value, fallback = 'unduhin') {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

function contentDisposition(filename, disposition = 'attachment') {
  const safe = sanitizeFilename(filename, 'unduhin');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function mimeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function isImage(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isVideo(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isAudio(filePath) {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isMediaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return !BLOCKED_EXTENSIONS.has(ext) && (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext));
}

async function listMediaFiles(dir, depth = 0, rootDir = dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < 3) files.push(...(await listMediaFiles(filePath, depth + 1, rootDir)));
      continue;
    }
    if (!entry.isFile() || !isMediaFile(filePath)) continue;
    const stat = await fsp.stat(filePath);
    if (stat.size <= 0) continue;
    files.push({
      path: filePath,
      name: path.relative(rootDir, filePath).split(path.sep).join('/'),
      size: stat.size,
      isVideo: isVideo(filePath),
      isImage: isImage(filePath),
      isAudio: isAudio(filePath)
    });
  }

  files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return files;
}

async function findMediaFile(dir, preferredExtensions = []) {
  const files = await listMediaFiles(dir);
  if (files.length === 0) return null;
  const preferred = new Set(preferredExtensions.map((ext) => `.${ext.replace(/^\./, '').toLowerCase()}`));
  return files.find((file) => preferred.has(path.extname(file.path).toLowerCase())) || files[0];
}

async function getFreeDiskMb(dir) {
  try {
    const stats = await fsp.statfs(dir);
    return Math.floor((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function createReadStream(filePath) {
  return fs.createReadStream(filePath);
}

module.exports = {
  ensureDir,
  removeDir,
  sanitizeFilename,
  contentDisposition,
  mimeFor,
  isImage,
  isVideo,
  isAudio,
  isMediaFile,
  listMediaFiles,
  findMediaFile,
  getFreeDiskMb,
  createReadStream
};
