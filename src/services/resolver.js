const config = require('../config');
const { AppError } = require('../lib/errors');
const {
  normalizeInput,
  assertPublicHost,
  platformForHost,
  isPhotoCapablePlatform,
  isPhotoFirstUrl
} = require('../lib/url');
const {
  collectFormats,
  isVideoFormat,
  isAudioFormat,
  groupQualities,
  pickThumbnail,
  pickText,
  pickDuration,
  assertDownloadableInfo
} = require('../lib/format');
const ytdlp = require('./ytdlp');
const tiktok = require('./tiktok');

const IMAGE_PATH = /\.(jpe?g|png|webp|gif|avif)$/i;

function canUsePhotoFallback(platform, url) {
  return isPhotoCapablePlatform(platform) || (config.allowAllSites && IMAGE_PATH.test(url.pathname));
}

function photoResult({ platform, url, title, thumbnail, uploader, photos, photoCount, maxSelectable }) {
  const result = {
    source: platform,
    title: pickText(title, `${platform} media`),
    uploader: pickText(uploader, ''),
    thumbnail: pickThumbnail({ thumbnail }),
    duration: null,
    webpageUrl: url.href,
    kind: 'photo',
    qualities: [],
    defaultQuality: null,
    hasAudio: false,
    photoHint: true
  };
  if (Array.isArray(photos)) {
    result.photos = photos;
    result.photoCount = photoCount ?? photos.length;
    result.maxSelectable = maxSelectable ?? photos.length;
  }
  return result;
}

function tiktokPhotoResult(url, post) {
  return photoResult({
    platform: 'TikTok',
    url,
    title: post.title,
    thumbnail: post.thumbnail,
    uploader: post.uploader,
    ...tiktok.publicPhotoPost(post)
  });
}

function chooseEntry(info) {
  if (!info || !Array.isArray(info.entries) || info.entries.length === 0) return info;
  const withVideo = info.entries.find((entry) => collectFormats(entry).some(isVideoFormat));
  return withVideo || info.entries[0];
}

function audioResult({ info, selected, platform, url }) {
  assertDownloadableInfo(selected, config);
  const formats = collectFormats(selected);
  const thumbnail = pickThumbnail(selected) || pickThumbnail(info);
  return {
    source: platform,
    title: pickText(selected.title, selected.description, info.title, info.description, `${platform} audio`),
    uploader: pickText(selected.uploader, selected.channel, selected.uploader_id, selected.nickname, ''),
    thumbnail,
    duration: pickDuration(selected) || pickDuration(info),
    webpageUrl: selected.webpage_url || info.webpage_url || url.href,
    kind: 'audio',
    qualities: [],
    defaultQuality: null,
    hasAudio: formats.some(isAudioFormat),
    photoHint: false
  };
}

function buildVideoResult({ info, selected, platform, url }) {
  assertDownloadableInfo(selected, config);

  const formats = collectFormats(selected);
  const qualities = groupQualities(selected, platform);
  if (qualities.length === 0) {
    qualities.push({
      height: 0,
      label: 'Terbaik',
      ext: selected.ext || 'mp4',
      fps: null,
      filesize: 0,
      watermarkFree: true
    });
  }

  const defaultQuality = qualities.find((quality) => quality.height > 0 && quality.height <= 1080) || qualities[0];
  const thumbnail = pickThumbnail(selected) || pickThumbnail(info);
  const hasAudio = formats.some(isAudioFormat) || Boolean(selected.acodec && selected.acodec !== 'none');

  return {
    source: platform,
    title: pickText(selected.title, selected.description, info.title, info.description, `${platform} media`),
    uploader: pickText(selected.uploader, selected.channel, selected.uploader_id, selected.nickname, ''),
    thumbnail,
    duration: pickDuration(selected) || pickDuration(info),
    webpageUrl: selected.webpage_url || info.webpage_url || url.href,
    kind: 'video',
    qualities,
    defaultQuality: defaultQuality.height,
    hasAudio,
    photoHint: false
  };
}

async function resolve(input, signal) {
  const url = normalizeInput(input);
  await assertPublicHost(url);

  const platform = platformForHost(url.hostname);

  if (isPhotoFirstUrl(url, platform)) {
    if (platform === 'TikTok') {
      const post = await tiktok.getPhotoPost(url, { signal });
      return tiktokPhotoResult(url, post);
    }
    return photoResult({ platform, url, title: `${platform} media` });
  }

  let info;
  try {
    info = await ytdlp.getInfo(url.href, signal);
  } catch (error) {
    if (
      platform === 'TikTok' &&
      error instanceof AppError &&
      ['UNSUPPORTED', 'FORMAT_UNAVAILABLE', 'NO_MEDIA', 'UNAVAILABLE', 'PROCESSING_FAILED', 'BOT_CHECK', 'ACCESS_DENIED'].includes(error.code)
    ) {
      const post = await tiktok.tryGetPhotoPost(url, { signal });
      if (post) return tiktokPhotoResult(url, post);
      throw error;
    }
    if (
      error instanceof AppError &&
      canUsePhotoFallback(platform, url) &&
      ['UNSUPPORTED', 'FORMAT_UNAVAILABLE', 'NO_MEDIA', 'UNAVAILABLE', 'PROCESSING_FAILED'].includes(error.code)
    ) {
      return photoResult({ platform, url, title: `${platform} media` });
    }
    throw error;
  }

  const selected = chooseEntry(info);
  const formats = collectFormats(selected);
  const hasVideo = formats.some(isVideoFormat) || Boolean(selected.vcodec && selected.vcodec !== 'none' && selected.url);
  const hasAudio = formats.some(isAudioFormat);

  if (!hasVideo && platform === 'TikTok') {
    const post = await tiktok.tryGetPhotoPost(url, { signal });
    if (post) return tiktokPhotoResult(url, post);
  }

  if (!hasVideo && hasAudio) {
    return audioResult({ info, selected, platform, url });
  }

  if (!hasVideo) {
    if (formats.length > 0 || (canUsePhotoFallback(platform, url) && platform !== 'TikTok')) {
      return photoResult({
        platform,
        url,
        title: selected.title || info.title,
        thumbnail: pickThumbnail(selected) || pickThumbnail(info),
        uploader: selected.uploader || info.uploader
      });
    }
    throw new AppError('NO_MEDIA', 'Tidak ada media video, audio, atau foto yang ditemukan.', 422);
  }

  return buildVideoResult({ info, selected, platform, url });
}

module.exports = { resolve, chooseEntry };
