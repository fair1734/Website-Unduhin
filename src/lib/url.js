const dns = require('node:dns').promises;
const net = require('node:net');
const config = require('../config');
const { AppError } = require('./errors');

const ALLOWED_DOMAINS = [
  'tiktok.com',
  'douyin.com',
  'iesdouyin.com',
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'twitter.com',
  'x.com',
  't.co',
  'facebook.com',
  'fb.com',
  'fb.watch',
  'instagram.com',
  'instagr.am',
  'threads.net',
  'threads.com',
  'vimeo.com',
  'dailymotion.com',
  'dai.ly',
  'twitch.tv',
  'reddit.com',
  'redd.it',
  'pinterest.com',
  'pin.it',
  'snapchat.com',
  'likee.video',
  'likee.com',
  'rumble.com',
  'odysee.com',
  'soundcloud.com',
  'bilibili.com',
  'b23.tv',
  'vk.com',
  'ok.ru',
  'linkedin.com',
  'tumblr.com',
  'imgur.com',
  '9gag.com',
  'streamable.com',
  'capcut.com',
  'kuaishou.com',
  'weibo.com',
  'ixigua.com',
  'nicovideo.jp',
  'bandcamp.com',
  'bitchute.com',
  'ted.com'
];

const PLATFORM_DOMAINS = [
  ['tiktok.com', 'TikTok'],
  ['douyin.com', 'Douyin'],
  ['iesdouyin.com', 'Douyin'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['youtube-nocookie.com', 'YouTube'],
  ['twitter.com', 'X'],
  ['x.com', 'X'],
  ['t.co', 'X'],
  ['facebook.com', 'Facebook'],
  ['fb.com', 'Facebook'],
  ['fb.watch', 'Facebook'],
  ['instagram.com', 'Instagram'],
  ['instagr.am', 'Instagram'],
  ['threads.net', 'Threads'],
  ['threads.com', 'Threads'],
  ['vimeo.com', 'Vimeo'],
  ['dailymotion.com', 'Dailymotion'],
  ['dai.ly', 'Dailymotion'],
  ['twitch.tv', 'Twitch'],
  ['reddit.com', 'Reddit'],
  ['redd.it', 'Reddit'],
  ['pinterest.com', 'Pinterest'],
  ['pin.it', 'Pinterest'],
  ['snapchat.com', 'Snapchat'],
  ['likee.video', 'Likee'],
  ['likee.com', 'Likee'],
  ['rumble.com', 'Rumble'],
  ['odysee.com', 'Odysee'],
  ['soundcloud.com', 'SoundCloud'],
  ['bilibili.com', 'Bilibili'],
  ['b23.tv', 'Bilibili'],
  ['vk.com', 'VK'],
  ['ok.ru', 'Odnoklassniki'],
  ['linkedin.com', 'LinkedIn'],
  ['tumblr.com', 'Tumblr'],
  ['imgur.com', 'Imgur'],
  ['9gag.com', '9GAG'],
  ['streamable.com', 'Streamable'],
  ['capcut.com', 'CapCut'],
  ['kuaishou.com', 'Kuaishou'],
  ['weibo.com', 'Weibo'],
  ['ixigua.com', 'Ixigua'],
  ['nicovideo.jp', 'Niconico'],
  ['bandcamp.com', 'Bandcamp'],
  ['bitchute.com', 'BitChute'],
  ['ted.com', 'TED']
];

const PHOTO_PLATFORMS = new Set([
  'TikTok',
  'Douyin',
  'Instagram',
  'Threads',
  'X',
  'Facebook',
  'Pinterest',
  'Reddit',
  'Tumblr',
  'VK',
  'Weibo'
]);

function stripBrackets(hostname) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase().replace(/\.$/, '');
}

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isAllowedHost(hostname, allowAll = config.allowAllSites) {
  const host = stripBrackets(hostname);
  if (allowAll) return true;
  return ALLOWED_DOMAINS.some((domain) => hostMatches(host, domain));
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

  if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
  if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
  if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
  if (parts[0] >= 224) return true;

  return false;
}

function isPrivateIp(ip) {
  const value = stripBrackets(String(ip || ''));
  if (net.isIPv4(value)) return isPrivateIpv4(value);
  if (!net.isIPv6(value)) return true;

  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith('ff')) return true;
  if (value.startsWith('2001:db8')) return true;

  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  return false;
}

function normalizeInput(input) {
  if (typeof input !== 'string') {
    throw new AppError('INVALID_URL', 'Tautan tidak valid.', 400);
  }

  let value = input.trim().replace(/[\u200b-\u200d\ufeff]/gi, '');
  if (!value) {
    throw new AppError('INVALID_URL', 'Tempel tautan terlebih dahulu.', 400);
  }
  if (value.length > 2048) {
    throw new AppError('INVALID_URL', 'Tautan terlalu panjang.', 400);
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('INVALID_URL', 'Format tautan tidak valid.', 400);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('INVALID_URL', 'Hanya tautan http atau https yang didukung.', 400);
  }
  if (url.username || url.password) {
    throw new AppError('INVALID_URL', 'Tautan tidak boleh berisi kredensial.', 400);
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new AppError('INVALID_URL', 'Port pada tautan tidak diizinkan.', 400);
  }

  const hostname = stripBrackets(url.hostname);
  if (!hostname) {
    throw new AppError('INVALID_URL', 'Host pada tautan tidak valid.', 400);
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new AppError('PRIVATE_ADDRESS', 'Alamat lokal tidak diizinkan.', 400);
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new AppError('PRIVATE_ADDRESS', 'Alamat IP privat tidak diizinkan.', 400);
  }
  if (!isAllowedHost(hostname)) {
    throw new AppError('DOMAIN_NOT_ALLOWED', 'Domain ini belum ada di daftar platform yang didukung.', 400);
  }

  return url;
}

async function assertPublicHost(url) {
  const hostname = stripBrackets(url.hostname);
  if (net.isIP(hostname)) return;

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    if (error && error.code === 'ENOTFOUND') {
      throw new AppError('DOMAIN_NOT_FOUND', 'Domain pada tautan tidak ditemukan.', 400);
    }
    if (config.allowAllSites) {
      throw new AppError('DOMAIN_NOT_FOUND', 'Domain pada tautan tidak bisa diverifikasi.', 502);
    }
    return;
  }

  if (!records.length) {
    throw new AppError('DOMAIN_NOT_FOUND', 'Domain pada tautan tidak ditemukan.', 400);
  }
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new AppError('PRIVATE_ADDRESS', 'Tautan mengarah ke alamat privat.', 400);
  }
}

function platformForHost(hostname) {
  const host = stripBrackets(hostname);
  for (const [domain, label] of PLATFORM_DOMAINS) {
    if (hostMatches(host, domain)) return label;
  }
  return 'Lainnya';
}

function isPhotoCapablePlatform(platform) {
  return PHOTO_PLATFORMS.has(platform);
}

function isPhotoFirstUrl(url, platform) {
  const pathname = url.pathname.toLowerCase();
  if (platform === 'TikTok' || platform === 'Douyin') return pathname.includes('/photo/');
  if (platform === 'Instagram') return /\/p\//.test(pathname);
  if (platform === 'Pinterest') return /\/pin\//.test(pathname);
  if (platform === 'Facebook') return /\/(photo|photos|media)\//.test(pathname);
  if (platform === 'Threads' || platform === 'Tumblr') return /\/post\//.test(pathname);
  if (platform === 'Reddit') return /\/gallery\//.test(pathname);
  return false;
}

function isKnownVideoUrl(url, platform) {
  const pathname = url.pathname.toLowerCase();
  if (platform === 'TikTok' || platform === 'Douyin') return pathname.includes('/video/');
  if (platform === 'Instagram') return /\/(reel|reels|tv)\//.test(pathname);
  if (platform === 'Facebook') return /\/(watch|reel|reels|videos)\//.test(pathname);
  if (platform === 'YouTube') return true;
  return false;
}

module.exports = {
  ALLOWED_DOMAINS,
  isAllowedHost,
  isPrivateIp,
  normalizeInput,
  assertPublicHost,
  platformForHost,
  isPhotoCapablePlatform,
  isPhotoFirstUrl,
  isKnownVideoUrl,
  stripBrackets
};
