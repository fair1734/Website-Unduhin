const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isVideoFormat,
  isAudioFormat,
  isWatermarked,
  groupQualities,
  buildFormatSelector,
  pickText,
  pickDuration,
  assertDownloadableInfo
} = require('../src/lib/format');
const { parseProgress } = require('../src/services/ytdlp');

const info = {
  title: 'Video contoh',
  duration: 95,
  formats: [
    { format_id: '137', height: 1080, fps: 30, ext: 'mp4', vcodec: 'avc1', acodec: 'none', tbr: 4200, filesize: 30000000 },
    { format_id: '136', height: 720, fps: 30, ext: 'mp4', vcodec: 'avc1', acodec: 'none', tbr: 2200, filesize: 15000000 },
    { format_id: '18', height: 720, fps: 30, ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', tbr: 1200, filesize: 12000000 },
    { format_id: 'download_addr', height: 1080, ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', format_note: 'watermarked' },
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 129, filesize: 1500000 }
  ]
};

test('membedakan format video, audio, dan watermark', () => {
  assert.equal(isVideoFormat(info.formats[0]), true);
  assert.equal(isVideoFormat(info.formats[4]), false);
  assert.equal(isAudioFormat(info.formats[4]), true);
  assert.equal(isWatermarked(info.formats[3], 'TikTok'), true);
  assert.equal(isWatermarked(info.formats[0], 'TikTok'), false);
});

test('mengelompokkan kualitas dan membuang format berwatermark', () => {
  const qualities = groupQualities(info, 'TikTok');
  assert.deepEqual(qualities.map((quality) => quality.height), [1080, 720]);
  assert.equal(qualities[0].label, '1080p');
  assert.equal(qualities[0].filesize, 31500000);
  assert.equal(qualities[1].filesize, 16500000);
  assert.equal(qualities.every((quality) => quality.watermarkFree), true);
});

test('menyediakan kualitas Terbaik untuk format tanpa tinggi', () => {
  const direct = {
    formats: [{ format_id: 'mp4', ext: 'mp4', vcodec: null, audio_ext: 'none', url: 'https://contoh.com/a.mp4' }]
  };
  assert.equal(isVideoFormat(direct.formats[0]), true);
  const qualities = groupQualities(direct, 'Lainnya');
  assert.equal(qualities.length, 1);
  assert.equal(qualities[0].label, 'Terbaik');
  assert.equal(qualities[0].height, 0);
});

test('membangun pemilih format yang menghindari watermark TikTok', () => {
  const selector = buildFormatSelector(1080, 'TikTok');
  assert.match(selector, /height<=1080/);
  assert.match(selector, /download_addr/);
  assert.match(selector, /watermark/);
  assert.match(selector, /format_id!='download'/);
  assert.doesNotMatch(selector, /format_note/);
  assert.doesNotMatch(buildFormatSelector(720, 'YouTube'), /download_addr/);
});

test('membersihkan teks dan membaca metadata playlist', () => {
  assert.equal(pickText('  Judul\nBaru\u0000  '), 'Judul Baru');
  assert.equal(pickDuration({ entries: [{ duration: 12 }, { duration: 99 }] }), 12);
});

test('menolak siaran langsung dan durasi berlebihan', () => {
  assert.throws(() => assertDownloadableInfo({ is_live: true }, { maxDurationSeconds: 7200 }), { code: 'LIVE_NOT_SUPPORTED' });
  assert.throws(() => assertDownloadableInfo({ duration: 9000 }, { maxDurationSeconds: 7200 }), { code: 'TOO_LONG' });
});

test('membaca baris progres yt-dlp', () => {
  const progress = parseProgress('PROGRESS 5242880 10485760 10485760 204800 4');
  assert.equal(progress.percent, 50);
  assert.equal(progress.downloadedBytes, 5242880);
  assert.equal(progress.totalBytes, 10485760);
  assert.equal(progress.speed, 204800);
  assert.equal(progress.eta, 4);
  assert.equal(parseProgress('bukan progres'), null);
});
