class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isLoginError(error) {
  return error instanceof AppError && error.code === 'LOGIN_REQUIRED';
}

function mapToolError(raw, fallback = 'Gagal memproses tautan. Coba lagi.') {
  const text = String(raw || '').toLowerCase();

  if (/sign in to confirm|not a bot|confirm you.re not a bot|slardar|_wafchallengeid|captcha|waf challenge/.test(text)) {
    return new AppError('BOT_CHECK', 'Platform meminta verifikasi bot. Coba lagi nanti atau pasang cookies server.', 502);
  }
  if (/http error 403|forbidden|access denied/.test(text)) {
    return new AppError('ACCESS_DENIED', 'Platform menolak akses ke media ini. Muat ulang tautan lalu coba lagi.', 403);
  }
  if (/rate-limit reached|rate limit|http error 429/.test(text)) {
    return new AppError('RATE_LIMITED', 'Platform membatasi permintaan. Coba lagi beberapa saat lagi.', 429);
  }
  if (/login required|log in to|need to log in|login_required|empty media response/.test(text)) {
    return new AppError('LOGIN_REQUIRED', 'Konten ini membutuhkan login atau cookies server.', 422);
  }
  if (/ip address is blocked|blocked from accessing|ip blocked/.test(text)) {
    return new AppError('IP_BLOCKED', 'IP server diblokir oleh platform. Coba lagi nanti atau gunakan cookies.', 403);
  }
  if (/requested format is not available|format is not available|no video formats found|no formats found/.test(text)) {
    return new AppError('FORMAT_UNAVAILABLE', 'Format atau kualitas yang diminta tidak tersedia.', 422);
  }
  if (/no results|nothing found|no images found|no media found/.test(text)) {
    return new AppError('NO_MEDIA', 'Tidak ada media yang ditemukan pada tautan ini.', 422);
  }
  if (/not available in your country|geo[- ]?block|geo[- ]?restrict|region[- ]?lock/.test(text)) {
    return new AppError('GEO_BLOCKED', 'Konten dibatasi di wilayah server.', 451);
  }
  if (/file is larger than|max-filesize|too large/.test(text)) {
    return new AppError('TOO_LARGE', 'Ukuran file melebihi batas server.', 413);
  }
  if (/http error 404|http error 410|private video|private content|this post is private|not available|unavailable|does not exist/.test(text)) {
    return new AppError('UNAVAILABLE', 'Konten tidak tersedia, privat, atau sudah dihapus.', 422);
  }
  if (/does not pass filter/.test(text)) {
    return new AppError('TOO_LONG', 'Durasi media melebihi batas server atau siaran langsung tidak didukung.', 413);
  }
  if (/timed out|timeout/.test(text)) {
    return new AppError('TIMEOUT', 'Pengambilan media terlalu lama. Coba lagi.', 504);
  }
  if (/no space left|disk full|enospc/.test(text)) {
    return new AppError('SERVER_FULL', 'Penyimpanan server penuh. Coba lagi nanti.', 507);
  }
  if (/unsupported url|unsupported site/.test(text)) {
    return new AppError('UNSUPPORTED', 'Tautan ini belum didukung atau tidak memiliki media yang bisa diunduh.', 422);
  }

  return new AppError('PROCESSING_FAILED', fallback, 502);
}

module.exports = { AppError, isLoginError, mapToolError };
