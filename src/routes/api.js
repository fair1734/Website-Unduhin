const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { spawnSync } = require('node:child_process');
const config = require('../config');
const { AppError } = require('../lib/errors');
const { contentDisposition, mimeFor, sanitizeFilename } = require('../lib/files');
const resolver = require('../services/resolver');
const jobs = require('../services/jobs');
const ytdlp = require('../services/ytdlp');
const gallerydl = require('../services/gallerydl');
const BLOB_TEST_PATH = 'diagnostics/unduhin-test.txt';

const router = express.Router();

function parseRange(header, size) {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return { invalid: true };

  const hasStart = match[1] !== '';
  const hasEnd = match[2] !== '';
  if (!hasStart && !hasEnd) return { invalid: true };

  let start;
  let end;

  if (!hasStart) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return { invalid: true };
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = hasEnd ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    start >= size
  ) {
    return { invalid: true };
  }

  return { start, end: Math.min(end, size - 1) };
}

router.get('/health', async (req, res, next) => {
  try {
    const [ytdlpVersion, gallerydlVersion] = await Promise.all([
      ytdlp.getVersion(),
      gallerydl.getVersion()
    ]);

    const probe = spawnSync(
      config.galleryDlPath,
      [
        ...(config.galleryDlArgs || []),
        '-c',
        'import gallery_dl; print("import-ok")'
      ],
      {
        encoding: 'utf8',
        timeout: 8000,
        env: process.env
      }
    );

    let galleryDiagnostic;

    if (probe.error) {
      galleryDiagnostic = probe.error.code || 'SPAWN_ERROR';
    } else if (probe.signal) {
      galleryDiagnostic = `SIGNAL_${probe.signal}`;
    } else if (probe.status !== 0) {
      galleryDiagnostic = `EXIT_${probe.status}`;
    } else {
      galleryDiagnostic = 'OK';
    }

    const ok = Boolean(ytdlpVersion && gallerydlVersion);

    res.status(ok ? 200 : 503);
    res.set('Cache-Control', 'no-store');

    res.json({
      ok,
      uptime: Math.round(process.uptime()),
      tools: {
        ytdlp: ytdlpVersion,
        galleryDl: gallerydlVersion
      },
      diagnostics: {
        pythonGalleryDl: galleryDiagnostic,
        detail: probe.error
          ? probe.error.message
          : (probe.stderr || probe.stdout || '').trim().slice(0, 300)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/resolve', async (req, res) => {
  const data = await resolver.resolve(req.body?.url, req.signal);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, data });
});

router.post('/jobs', async (req, res) => {
  const job = await jobs.createJob({
    url: req.body?.url,
    format: req.body?.format,
    height: req.body?.height,
    title: req.body?.title,
    photoIndices: req.body?.photoIndices
  });

  res.status(201);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, job });
});

router.get('/jobs/:id', (req, res) => {
  const job = jobs.requireJob(req.params.id);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, job: jobs.publicJob(job) });
});

router.get('/jobs/:id/events', (req, res) => {
  const job = jobs.requireJob(req.params.id);

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.flushHeaders();
  jobs.subscribe(job, res);
});

router.post('/jobs/:id/cancel', async (req, res) => {
  const job = await jobs.cancelJob(req.params.id);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, job });
});

router.delete('/jobs/:id', async (req, res) => {
  await jobs.deleteJob(req.params.id);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

router.get('/jobs/:id/file', async (req, res, next) => {
  try {
    const rawIndex = String(req.query.i ?? '');

    if (!/^\d+$/.test(rawIndex)) {
      throw new AppError('INVALID_FILE', 'Indeks file tidak valid.', 400);
    }

    const index = Number.parseInt(rawIndex, 10);
    const { file } = jobs.getJobFile(req.params.id, index);
    const stat = await fs.promises.stat(file.path);
    const disposition = req.query.download === '1'
      ? 'attachment'
      : 'inline';
    const filename = path.basename(file.name);
    const range = parseRange(req.headers.range, stat.size);

    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeFor(file.path),
      'Content-Disposition': contentDisposition(filename, disposition),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    });

    if (range && range.invalid) {
      res.status(416);
      res.set('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }

    if (range) {
      const { start, end } = range;

      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': String(end - start + 1)
      });

      const stream = fs.createReadStream(file.path, { start, end });

      stream.on('error', (error) => {
        if (!res.headersSent) next(error);
        else res.destroy(error);
      });

      stream.pipe(res);
      return;
    }

    res.set('Content-Length', String(stat.size));

    const stream = fs.createReadStream(file.path);

    stream.on('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });

    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

router.get('/jobs/:id/zip', async (req, res, next) => {
  try {
    const { ZipArchive } = await import('archiver');
    const job = jobs.requireJob(req.params.id);

    if (job.status !== 'ready') {
      throw new AppError(
        'JOB_NOT_READY',
        'Unduhan belum selesai.',
        409
      );
    }

    if (!job.files.length) {
      throw new AppError(
        'FILE_NOT_FOUND',
        'File tidak ditemukan.',
        404
      );
    }

    const zipName = `${sanitizeFilename(job.title, 'unduhin')}.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(zipName, 'attachment'),
      'Cache-Control': 'no-store'
    });

    const archive = new ZipArchive({ zlib: { level: 6 } });

    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT' && !res.headersSent) {
        next(error);
      }
    });

    archive.on('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });

    res.on('close', () => {
      if (!res.writableEnded) archive.abort();
    });

    archive.pipe(res);

    job.files.forEach((file, index) => {
      const basename = sanitizeFilename(
        path.basename(file.name),
        `file-${index + 1}`
      );

      const name = job.format === 'photo'
        ? basename
        : `${String(index + 1).padStart(2, '0')}-${basename}`;

      archive.append(fs.createReadStream(file.path), { name });
    });

    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

/*
 * ENDPOINT TES BLOB
 * Mengunggah teks kecil ke Vercel Blob.
 */
router.post('/blob-upload-test', async (req, res, next) => {
  try {
    const { put } = await import('@vercel/blob');

    const blob = await put(
      'diagnostics/unduhin-test.txt',
      'Unduhin Blob upload test OK',
      {
        access: 'private',
        addRandomSuffix: true,
        contentType: 'text/plain'
      }
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      message: 'Upload Blob berhasil',
      pathname: blob.pathname
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;