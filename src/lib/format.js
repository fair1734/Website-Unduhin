const { AppError } = require('./errors');

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'webm', 'mov', 'm4v', 'ts', 'flv', 'avi']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg', 'wav', 'flac']);

function isVideoFormat(format) {
  if (!format) return false;
  if (format.vcodec === 'none') return false;
  if (format.vcodec) return true;
  if (format.video_ext && format.video_ext !== 'none') return true;
  const ext = String(format.ext || '').toLowerCase();
  return VIDEO_EXTENSIONS.has(ext) && (!format.audio_ext || format.audio_ext === 'none');
}

function isAudioFormat(format) {
  if (!format) return false;
  if (format.acodec === 'none') return false;
  if (format.acodec) return true;
  if (format.audio_ext && format.audio_ext !== 'none') return true;
  const ext = String(format.ext || '').toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

function isWatermarked(format, platform) {
  if (!format) return false;
  const note = `${format.format_note || ''} ${format.format_id || ''}`.toLowerCase();
  if (note.includes('watermark')) return true;
  if ((platform === 'TikTok' || platform === 'Douyin') && note.includes('download_addr')) return true;
  return false;
}

function collectFormats(info) {
  if (Array.isArray(info?.formats) && info.formats.length) return info.formats;
  if (Array.isArray(info?.entries)) {
    const entry = info.entries.find((item) => item && Array.isArray(item.formats) && item.formats.length);
    if (entry) return entry.formats;
  }
  return [];
}

function formatSize(format) {
  return numeric(format?.filesize) || numeric(format?.filesize_approx) || 0;
}

function formatBitrate(format) {
  return numeric(format?.tbr) || numeric(format?.vbr) || numeric(format?.abr) || 0;
}

function chooseBetter(candidate, current) {
  if (!current) return candidate;
  const currentHeight = numeric(current.height);
  const candidateHeight = numeric(candidate.height);
  if (candidateHeight !== currentHeight) return candidateHeight > currentHeight ? candidate : current;
  const currentFps = numeric(current.fps);
  const candidateFps = numeric(candidate.fps);
  if (candidateFps !== currentFps) return candidateFps > currentFps ? candidate : current;
  return formatBitrate(candidate) > formatBitrate(current) ? candidate : current;
}

function groupQualities(info, platform) {
  const formats = collectFormats(info);
  const usable = formats.filter((format) => format && !isWatermarked(format, platform));
  const videos = usable.filter(isVideoFormat);
  const audios = usable.filter((format) => !isVideoFormat(format) && isAudioFormat(format));

  const bestAudio = audios.reduce((best, format) => chooseBetter(format, best), null);
  const byHeight = new Map();
  let unknownHeight = null;

  for (const video of videos) {
    const height = Math.round(numeric(video.height));
    if (height <= 0) {
      if (!unknownHeight || chooseBetter(video, unknownHeight.video) === video) {
        unknownHeight = { video, progressive: isAudioFormat(video) };
      }
      continue;
    }
    const progressive = isAudioFormat(video);
    const choice = { video, progressive };
    const current = byHeight.get(height);
    if (!current || chooseBetter(video, current.video) === video) {
      byHeight.set(height, choice);
    }
  }

  if (byHeight.size === 0 && unknownHeight) {
    byHeight.set(0, unknownHeight);
  }

  const qualities = [];
  for (const [height, choice] of byHeight) {
    const videoSize = formatSize(choice.video);
    const audioSize = choice.progressive ? 0 : formatSize(bestAudio);
    qualities.push({
      height,
      label: height > 0 ? (height >= 2160 ? '4K' : height >= 1440 ? '2K' : `${height}p`) : 'Terbaik',
      ext: choice.video.ext || 'mp4',
      fps: numeric(choice.video.fps) || null,
      filesize: videoSize && (!audioSize || choice.progressive) ? videoSize : videoSize && audioSize ? videoSize + audioSize : 0,
      watermarkFree: true
    });
  }

  qualities.sort((a, b) => b.height - a.height);
  return qualities;
}

function buildFormatSelector(height, platform) {
  const cap = height > 0 ? `[height<=${Math.round(height)}]` : '';
  const clean = '[format_id!*=watermark]';
  const shortVideo = platform === 'TikTok' || platform === 'Douyin';
  const tiktokClean = `${clean}[format_id!='download'][format_id!*=download_addr]`;

  if (shortVideo) {
    return [
      `b${cap}${tiktokClean}`,
      `bv*${cap}${tiktokClean}+ba`,
      `b${cap}${tiktokClean}+ba`
    ].join('/');
  }

  return [
    `bv*${cap}${clean}+ba`,
    `b${cap}${clean}`,
    `bv*${cap}+ba`,
    `b${cap}`,
    'b'
  ].join('/');
}

function pickThumbnail(info) {
  const candidates = [];
  if (info?.thumbnail) candidates.push(info.thumbnail);
  if (Array.isArray(info?.thumbnails)) {
    for (const thumb of info.thumbnails) {
      if (thumb?.url) candidates.push(thumb.url);
    }
  }
  return candidates.find((url) => typeof url === 'string' && /^https?:\/\//i.test(url)) || null;
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    }
  }
  return '';
}

function pickDuration(info) {
  const direct = numeric(info?.duration);
  if (direct > 0) return direct;
  if (Array.isArray(info?.entries)) {
    const entry = info.entries.find((item) => item && numeric(item.duration) > 0);
    if (entry) return numeric(entry.duration);
  }
  return null;
}

function assertDownloadableInfo(info, config) {
  if (!info || typeof info !== 'object') {
    throw new AppError('UNSUPPORTED', 'Tautan tidak menghasilkan media yang bisa diunduh.', 422);
  }
  if (info.is_live) {
    throw new AppError('LIVE_NOT_SUPPORTED', 'Siaran langsung belum didukung.', 422);
  }
  const duration = pickDuration(info);
  if (duration && duration > config.maxDurationSeconds) {
    throw new AppError('TOO_LONG', 'Durasi media melebihi batas server.', 413);
  }
}

module.exports = {
  collectFormats,
  isVideoFormat,
  isAudioFormat,
  isWatermarked,
  groupQualities,
  buildFormatSelector,
  pickThumbnail,
  pickText,
  pickDuration,
  assertDownloadableInfo
};
