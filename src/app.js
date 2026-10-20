const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const apiRouter = require('./routes/api');
const { AppError } = require('./lib/errors');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'none'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'media-src': ["'self'", 'blob:', 'https:'],
      'connect-src': ["'self'"],
      'font-src': ["'self'", 'data:']
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(express.json({ limit: '16kb' }));

const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD',
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' }
    });
  }
});

app.use('/api', limiter, apiRouter);

const publicDir = path.join(config.rootDir, 'public');
app.use(express.static(publicDir, {
  index: 'index.html',
  etag: true,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use('/api', (req, res) => {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' }
  });
});

app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) {
    res.status(404).sendFile(path.join(publicDir, '404.html'), (error) => {
      if (error && !res.headersSent) res.status(404).type('text/plain').send('Halaman tidak ditemukan.');
    });
    return;
  }
  res.status(404).type('text/plain').send('Halaman tidak ditemukan.');
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  res.removeHeader('Content-Disposition');
  res.removeHeader('Content-Length');
  res.type('application/json');

  if (error && error.type === 'entity.too.large') {
    res.status(413).json({
      ok: false,
      error: { code: 'BODY_TOO_LARGE', message: 'Permintaan terlalu besar.' }
    });
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    res.status(400).json({
      ok: false,
      error: { code: 'INVALID_JSON', message: 'Body permintaan bukan JSON yang valid.' }
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      ok: false,
      error: { code: error.code, message: error.message }
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server.' }
  });
});

module.exports = app;
