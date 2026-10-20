const crypto = require('node:crypto');
const path = require('node:path');
const fsp = require('node:fs/promises');
const config = require('../config');
const { AppError } = require('../lib/errors');
const { ensureDir, removeDir, getFreeDiskMb, sanitizeFilename } = require('../lib/files');
const { parseSelection } = require('../lib/selection');
const {
  normalizeInput,
  assertPublicHost,
  platformForHost,
  isPhotoFirstUrl
} = require('../lib/url');
const ytdlp = require('./ytdlp');
const gallerydl = require('./gallerydl');

const jobs = new Map();
const queue = [];
const TERMINAL = new Set(['ready', 'failed', 'cancelled']);
let running = 0;
let sweeper = null;

function isTerminal(job) {
  return TERMINAL.has(job.status);
}

function fileType(file) {
  if (file.isImage) return 'image';
  if (file.isVideo) return 'video';
  return 'audio';
}

function publicJob(job) {
  const files = job.status === 'ready'
    ? job.files.map((file, index) => ({
      index,
      name: path.basename(file.name),
      size: file.size,
      type: fileType(file),
      url: `/api/jobs/${job.id}/file?i=${index}`
    }))
    : [];

  return {
    id: job.id,
    status: job.status,
    format: job.format,
    platform: job.platform,
    title: job.title,
    photoIndices: Array.isArray(job.photoIndices) ? job.photoIndices : null,
    progress: job.progress,
    error: job.error,
    files,
    fileCount: files.length,
    zipUrl: files.length > 1 ? `/api/jobs/${job.id}/zip` : null,
    queuePosition: job.status === 'queued' ? queue.indexOf(job) + 1 : null,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    expiresAt: new Date(job.expiresAt).toISOString()
  };
}

function notify(job) {
  if (!job.clients || job.clients.size === 0) return;
  const payload = `event: update\ndata: ${JSON.stringify(publicJob(job))}\n\n`;
  const terminal = isTerminal(job);

  for (const [res, timer] of job.clients) {
    try {
      res.write(payload);
    } catch {
      clearInterval(timer);
      job.clients.delete(res);
      continue;
    }
    if (terminal) {
      clearInterval(timer);
      job.clients.delete(res);
      try {
        res.end();
      } catch {
      }
    }
  }
}

function subscribe(job, res) {
  res.write('retry: 3000\n\n');
  try {
    res.write(`event: update\ndata: ${JSON.stringify(publicJob(job))}\n\n`);
  } catch {
    return;
  }

  if (isTerminal(job)) {
    res.end();
    return;
  }

  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(timer);
      job.clients.delete(res);
    }
  }, 15000);
  timer.unref();

  job.clients.set(res, timer);
  res.on('close', () => {
    clearInterval(timer);
    job.clients.delete(res);
  });
}

function updateProgress(job, progress) {
  job.progress = {
    ...job.progress,
    ...progress,
    percent: progress.percent === null || progress.percent === undefined
      ? job.progress.percent
      : Math.round(progress.percent * 10) / 10
  };
  const now = Date.now();
  if (now - job.lastProgressAt >= 700) {
    job.lastProgressAt = now;
    notify(job);
  }
}

async function discardFiles(job) {
  if (job.dir) {
    await removeDir(job.dir);
    job.dir = null;
  }
  job.files = [];
}

async function runJob(job) {
  job.status = job.format === 'photo' ? 'processing' : 'downloading';
  job.startedAt = Date.now();
  job.abort = new AbortController();
  job.progress = {
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    eta: 0,
    filesDone: 0,
    filesTotal: 0
  };
  notify(job);

  try {
    if (job.format === 'photo') {
      job.files = await gallerydl.downloadPhotos({
        url: job.url,
        jobDir: job.dir,
        signal: job.abort.signal,
        platform: job.platform,
        photoIndices: job.photoIndices,
        onProgress: (progress) => updateProgress(job, progress)
      });
    } else if (job.format === 'audio') {
      const file = await ytdlp.downloadAudio({
        url: job.url,
        jobDir: job.dir,
        signal: job.abort.signal,
        onProgress: (progress) => updateProgress(job, progress)
      });
      job.files = [file];
    } else {
      const file = await ytdlp.downloadVideo({
        url: job.url,
        height: job.height,
        platform: job.platform,
        jobDir: job.dir,
        signal: job.abort.signal,
        onProgress: (progress) => updateProgress(job, progress)
      });
      job.files = [file];
    }

    if (job.abort.signal.aborted) {
      throw new AppError('CANCELLED', 'Unduhan dibatalkan.', 499);
    }
    if (!job.files.length) {
      throw new AppError('NO_MEDIA', 'Tidak ada media yang berhasil diunduh.', 422);
    }

    job.status = 'ready';
    job.finishedAt = Date.now();
    job.expiresAt = Date.now() + config.jobTtlMs;
    job.progress = {
      percent: 100,
      downloadedBytes: job.progress.downloadedBytes,
      totalBytes: job.progress.totalBytes,
      speed: 0,
      eta: 0
    };
  } catch (error) {
    const cancelled = job.abort.signal.aborted || (error instanceof AppError && error.code === 'CANCELLED');
    job.status = cancelled ? 'cancelled' : 'failed';
    job.finishedAt = Date.now();
    job.error = cancelled
      ? { code: 'CANCELLED', message: 'Unduhan dibatalkan.' }
      : {
        code: error instanceof AppError ? error.code : 'PROCESSING_FAILED',
        message: error instanceof AppError ? error.message : 'Terjadi kesalahan saat memproses media.'
      };
    await discardFiles(job);
  } finally {
    job.abort = null;
    job.lastProgressAt = 0;
    notify(job);
    if (job.resolveDone) job.resolveDone();
    running = Math.max(0, running - 1);
    pump();
  }
}

function pump() {
  while (running < config.maxConcurrent && queue.length > 0) {
    const job = queue.shift();
    if (job.status !== 'queued') continue;
    running += 1;
    runJob(job).catch(() => {
      running = Math.max(0, running - 1);
      pump();
    });
  }
}

async function cleanupJob(job) {
  if (job.status === 'queued') {
    const index = queue.indexOf(job);
    if (index !== -1) queue.splice(index, 1);
  }
  await discardFiles(job);
  for (const [res, timer] of job.clients || []) {
    clearInterval(timer);
    try {
      res.end();
    } catch {
    }
  }
  if (job.clients) job.clients.clear();
  jobs.delete(job.id);
}

async function createJob(options) {
  const url = normalizeInput(options.url);
  await assertPublicHost(url);

  const platform = platformForHost(url.hostname);
  const photoFirst = isPhotoFirstUrl(url, platform);
  let format = String(options.format || 'video').toLowerCase();
  if (photoFirst) format = 'photo';
  if (!['video', 'audio', 'photo'].includes(format)) {
    throw new AppError('INVALID_FORMAT', 'Format unduhan tidak valid.', 400);
  }

  let photoIndices = null;
  if (options.photoIndices !== null && options.photoIndices !== undefined) {
    if (format !== 'photo') {
      throw new AppError('INVALID_PHOTO_SELECTION', 'Pemilihan foto hanya berlaku untuk format foto.', 400);
    }
    photoIndices = parseSelection(options.photoIndices, { max: config.maxPhotos });
  }

  let height = Number.parseInt(options.height, 10);
  if (!Number.isFinite(height) || height < 0) height = 0;
  height = Math.min(height, 4320);

  const terminal = [...jobs.values()].filter(isTerminal).sort((a, b) => a.createdAt - b.createdAt);
  for (const job of terminal) {
    if (Date.now() > job.expiresAt || jobs.size >= config.maxQueue + config.maxConcurrent + 20) {
      await cleanupJob(job);
    }
  }

  if (queue.length >= config.maxQueue) {
    throw new AppError('QUEUE_FULL', 'Antrean penuh. Coba lagi beberapa saat lagi.', 503);
  }

  await ensureDir(config.tmpDir);
  const freeMb = await getFreeDiskMb(config.tmpDir);
  if (freeMb < config.minFreeDiskMb) {
    throw new AppError('SERVER_FULL', 'Penyimpanan server sedang penuh. Coba lagi nanti.', 507);
  }

  const id = crypto.randomBytes(12).toString('hex');
  const dir = path.join(config.tmpDir, id);
  await ensureDir(dir);

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const job = {
    id,
    url: url.href,
    platform,
    format,
    height,
    photoIndices,
    title: sanitizeFilename(options.title || `${platform} media`, 'unduhin'),
    status: 'queued',
    progress: { percent: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, eta: 0 },
    error: null,
    files: [],
    dir,
    clients: new Map(),
    abort: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    expiresAt: Date.now() + config.jobTtlMs,
    lastProgressAt: 0,
    done,
    resolveDone
  };

  jobs.set(id, job);
  queue.push(job);
  notify(job);
  pump();
  return publicJob(job);
}

function getJob(id) {
  return jobs.get(String(id)) || null;
}

function requireJob(id) {
  const job = getJob(id);
  if (!job) throw new AppError('JOB_NOT_FOUND', 'Unduhan tidak ditemukan atau sudah kedaluwarsa.', 404);
  return job;
}

function getJobFile(id, index) {
  const job = requireJob(id);
  if (job.status !== 'ready') {
    throw new AppError('JOB_NOT_READY', 'Unduhan belum selesai.', 409);
  }
  const item = job.files[Number(index)];
  if (!item) throw new AppError('FILE_NOT_FOUND', 'File tidak ditemukan.', 404);
  if (job.dir) {
    const root = path.resolve(job.dir) + path.sep;
    if (!path.resolve(item.path).startsWith(root)) {
      throw new AppError('FILE_NOT_FOUND', 'File tidak ditemukan.', 404);
    }
  }
  return { job, file: item };
}

async function cancelJob(id) {
  const job = requireJob(id);
  if (isTerminal(job)) return publicJob(job);

  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    job.error = { code: 'CANCELLED', message: 'Unduhan dibatalkan.' };
    const index = queue.indexOf(job);
    if (index !== -1) queue.splice(index, 1);
    await discardFiles(job);
    if (job.resolveDone) job.resolveDone();
    notify(job);
    return publicJob(job);
  }

  job.status = 'cancelling';
  notify(job);
  if (job.abort) job.abort.abort();
  return publicJob(job);
}

async function deleteJob(id) {
  const job = requireJob(id);
  if (!isTerminal(job)) {
    const queued = job.status === 'queued';
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    if (job.abort) job.abort.abort();
    const index = queue.indexOf(job);
    if (index !== -1) queue.splice(index, 1);
    if (queued && job.resolveDone) job.resolveDone();
    if (!queued) {
      await Promise.race([
        job.done,
        new Promise((resolve) => setTimeout(resolve, 5000).unref())
      ]);
    }
  }
  await cleanupJob(job);
  return { deleted: true };
}

async function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (!jobs.has(id)) continue;
    const maxLifetime = config.jobTtlMs + config.downloadTimeoutMs + 60000;
    if (!isTerminal(job)) {
      if (job.status === 'queued' && now - job.createdAt > maxLifetime) {
        job.status = 'cancelled';
        job.finishedAt = now;
        job.error = { code: 'CANCELLED', message: 'Unduhan dibatalkan karena menunggu terlalu lama.' };
        const index = queue.indexOf(job);
        if (index !== -1) queue.splice(index, 1);
        await discardFiles(job);
        if (job.resolveDone) job.resolveDone();
        notify(job);
        continue;
      }
      if (now - job.createdAt > maxLifetime && job.status !== 'cancelling') {
        job.status = 'cancelling';
        if (job.abort) job.abort.abort();
        notify(job);
      }
      continue;
    }
    if (now > job.expiresAt) {
      await cleanupJob(job);
    }
  }
}

async function init() {
  await ensureDir(config.tmpDir);
  try {
    const entries = await fsp.readdir(config.tmpDir, { withFileTypes: true });
    const cutoff = Date.now() - config.jobTtlMs - 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const target = path.join(config.tmpDir, entry.name);
      try {
        const stat = await fsp.stat(target);
        if (stat.mtimeMs < cutoff) await removeDir(target);
      } catch {
      }
    }
  } catch {
  }
  if (!sweeper) {
    sweeper = setInterval(() => {
      sweep().catch(() => {});
    }, 60000);
    sweeper.unref();
  }
}

module.exports = {
  init,
  createJob,
  getJob,
  publicJob,
  subscribe,
  cancelJob,
  deleteJob,
  cleanupJob,
  getJobFile,
  requireJob
};
