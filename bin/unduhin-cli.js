'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');

const root = path.resolve(__dirname, '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Peringatan .env:', error.message);
  }
}

const config = require('../src/config');
const ytdlp = require('../src/services/ytdlp');
const gallerydl = require('../src/services/gallerydl');
const tiktok = require('../src/services/tiktok');
const { parseSelection, formatSelection } = require('../src/lib/selection');

const {
  normalizeInput,
  assertPublicHost,
  platformForHost,
  isPhotoFirstUrl
} = require('../src/lib/url');

function help() {
  console.log(`
Unduhin CLI

Pemakaian:
  node bin/unduhin-cli.js <URL> [opsi]

Opsi:
  --video                  Unduh video (default)
  --audio                  Unduh audio
  --photo                  Unduh foto; pilih lewat menu jika terminal interaktif
  --photo-select <nomor>   Pilih foto TikTok, misalnya 1,3,5-7
  --photo-all              Unduh semua foto tanpa menu
  --height <angka>         Batas tinggi video, misalnya 720
  -o, --output <path>      Folder hasil unduhan
  -h, --help               Tampilkan bantuan

Contoh:
  node bin/unduhin-cli.js "URL"
  node bin/unduhin-cli.js "URL" --audio
  node bin/unduhin-cli.js "URL" --photo
  node bin/unduhin-cli.js "URL" --photo-select 1,3,5
  node bin/unduhin-cli.js "URL" --photo-all
  node bin/unduhin-cli.js "URL" --height 720
  node bin/unduhin-cli.js "URL" -o /sdcard/Download/Unduhin
`);
}

function parseArgs(args) {
  const options = {
    url: null,
    format: 'video',
    height: 0,
    output: '/sdcard/Download/Unduhin',
    photoSelect: null,
    photoAll: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--video') {
      options.format = 'video';
    } else if (arg === '--audio') {
      options.format = 'audio';
    } else if (arg === '--photo') {
      options.format = 'photo';
    } else if (arg === '--photo-select') {
      const value = args[++i];

      if (value === undefined || value.startsWith('-') || !value.trim()) {
        throw new Error('--photo-select membutuhkan nomor foto, misalnya 1,3,5-7.');
      }

      options.photoSelect = value.trim();
      options.format = 'photo';
    } else if (arg === '--photo-all') {
      options.photoAll = true;
      options.format = 'photo';
    } else if (arg === '--height') {
      const value = args[++i];

      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error('--height harus berupa angka.');
      }

      options.height = Math.min(Number(value), 4320);
    } else if (arg === '-o' || arg === '--output') {
      const value = args[++i];

      if (!value) {
        throw new Error('Folder output belum diisi.');
      }

      options.output = path.resolve(value);
    } else if (arg.startsWith('-')) {
      throw new Error(`Opsi tidak dikenal: ${arg}`);
    } else if (!options.url) {
      options.url = arg;
    } else {
      throw new Error('URL diberikan lebih dari sekali.');
    }
  }

  if (options.photoSelect && options.photoAll) {
    throw new Error('Gunakan --photo-select atau --photo-all, bukan keduanya.');
  }
  if ((options.photoSelect || options.photoAll) && options.format !== 'photo') {
    throw new Error('Pilihan foto hanya bisa dipakai dengan format foto.');
  }

  return options;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function photoDimensions(photo) {
  return photo.width > 0 && photo.height > 0
    ? `${photo.width}×${photo.height}`
    : 'ukuran tidak tersedia';
}

function printPhotoList(post) {
  const count = post.photos.length;
  const width = String(count).length;
  console.log(`\nDitemukan ${count} foto:`);
  for (const photo of post.photos) {
    console.log(`  ${String(photo.index).padStart(width, ' ')}. ${photoDimensions(photo)}`);
  }
  if (post.photoCount > config.maxPhotos) {
    console.log(`Batas server ${config.maxPhotos} foto per unduhan.`);
  }
}

function progress(info = {}) {
  const parts = [];
  if (Number.isFinite(info.percent)) {
    parts.push(`${Math.max(0, Math.min(100, info.percent)).toFixed(1)}%`);
  }
  if (Number.isFinite(info.filesDone) && Number.isFinite(info.filesTotal) && info.filesTotal > 0) {
    parts.push(`foto ${info.filesDone}/${info.filesTotal}`);
  } else if (Number.isFinite(info.currentFile)) {
    parts.push(`foto ${info.currentFile}`);
  }
  if (parts.length > 0) {
    process.stderr.write(`\rProgres: ${parts.join(' · ')}   `);
  }
}

async function choosePhotoSelection(post, signal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    printPhotoList(post);
    console.log('1. Pilih nomor foto');
    console.log('2. Unduh semua foto');
    console.log('3. Batal');

    let answer = '';
    while (!['1', '2', '3'].includes(answer)) {
      answer = (await rl.question('Pilihan [2]: ', { signal })).trim() || '2';
      if (!['1', '2', '3'].includes(answer)) {
        console.log('Masukkan 1, 2, atau 3.');
      }
    }

    if (answer === '3') return { cancelled: true, indices: null };
    if (answer === '2') return { cancelled: false, indices: null };

    const max = Math.min(post.photoCount, config.maxPhotos);
    let indices = null;
    while (!indices) {
      const spec = (await rl.question('Nomor foto (contoh: 1,3,5-7, Ctrl+C untuk batal): ', { signal })).trim();
      try {
        indices = parseSelection(spec, { max });
      } catch (error) {
        console.log(`Pilihan tidak valid: ${error.message}`);
      }
    }
    console.log(`Foto dipilih: ${indices.length} dari ${post.photoCount} (${formatSelection(indices)}).`);
    return { cancelled: false, indices };
  } finally {
    rl.close();
  }
}

async function resolvePhotoSelection({ platform, url, options, signal }) {
  if (platform !== 'TikTok') {
    if (options.photoSelect) {
      throw new Error('Pemilihan nomor foto saat ini hanya tersedia untuk TikTok.');
    }
    return { post: null, indices: null };
  }

  const post = await tiktok.getPhotoPost(url, { signal });

  if (options.photoSelect) {
    console.log(`Ditemukan ${post.photoCount} foto.`);
    const indices = parseSelection(options.photoSelect, { max: Math.min(post.photoCount, config.maxPhotos) });
    console.log(`Foto dipilih: ${indices.length} dari ${post.photoCount} (${formatSelection(indices)}).`);
    return { post, indices };
  }

  if (options.photoAll || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`Ditemukan ${post.photoCount} foto.`);
    if (!options.photoAll) {
      console.log('Mode non-interaktif: semua foto akan diunduh.');
    }
    return { post, indices: null };
  }

  const choice = await choosePhotoSelection(post, signal);
  return { post, indices: choice.cancelled ? undefined : choice.indices, cancelled: choice.cancelled };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    help();
    return;
  }

  if (!options.url) {
    help();
    throw new Error('Masukkan URL media.');
  }

  const url = normalizeInput(options.url);
  await assertPublicHost(url);

  const platform = platformForHost(url.hostname);
  const photoFirst = isPhotoFirstUrl(url, platform);
  const format = photoFirst ? 'photo' : options.format;

  if (photoFirst && options.format !== 'photo') {
    console.log('Tautan foto terdeteksi; format otomatis menjadi foto.');
  }
  if (format !== 'photo' && (options.photoSelect || options.photoAll)) {
    throw new Error('Pilihan foto hanya bisa dipakai dengan format foto.');
  }

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once('SIGINT', onInterrupt);

  let jobDir = null;

  try {
    console.log(`Platform : ${platform}`);
    console.log(`Format   : ${format}`);
    console.log(`Output   : ${options.output}`);

    let photoPost = null;
    let photoIndices = null;

    if (format === 'photo') {
      const selection = await resolvePhotoSelection({
        platform,
        url,
        options,
        signal: controller.signal
      });
      if (selection.cancelled) {
        console.log('Dibatalkan.');
        return;
      }
      photoPost = selection.post;
      photoIndices = selection.indices;
    }

    await fs.mkdir(config.tmpDir, { recursive: true });
    await fs.mkdir(options.output, { recursive: true });
    jobDir = await fs.mkdtemp(path.join(config.tmpDir, 'unduhin-cli-'));

    console.log('Memulai unduhan...\n');

    let files;

    if (format === 'photo') {
      files = await gallerydl.downloadPhotos({
        url: url.href,
        jobDir,
        signal: controller.signal,
        platform,
        photoIndices,
        post: photoPost,
        onProgress: progress
      });
    } else if (format === 'audio') {
      const file = await ytdlp.downloadAudio({
        url: url.href,
        jobDir,
        signal: controller.signal,
        onProgress: progress
      });

      files = [file];
    } else {
      const file = await ytdlp.downloadVideo({
        url: url.href,
        height: options.height,
        platform,
        jobDir,
        signal: controller.signal,
        onProgress: progress
      });

      files = [file];
    }

    process.stderr.write('\n');

    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Tidak ada file media yang dihasilkan.');
    }

    let count = 0;

    for (const file of files) {
      const source = path.resolve(file.path);
      const relative = path.relative(jobDir, source);

      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error('Lokasi file hasil tidak valid.');
      }

      const stat = await fs.stat(source);
      if (!stat.isFile()) continue;

      const originalName = path.basename(file.name || source);

      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      let destination = path.join(options.output, originalName);
      let index = 1;

      while (true) {
        try {
          await fs.access(destination);
          destination = path.join(
            options.output,
            `${base} (${index++})${ext}`
          );
        } catch (error) {
          if (error.code === 'ENOENT') break;
          throw error;
        }
      }

      await fs.copyFile(source, destination);

      console.log(
        `Tersimpan: ${destination} (${formatBytes(stat.size)})`
      );

      count++;
    }

    if (!count) {
      throw new Error('Tidak ada file media yang berhasil disimpan.');
    }

    console.log(`\nSelesai! ${count} file tersimpan.`);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    if (jobDir) await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write('\n');
  if (error?.code === 'CANCELLED' || error?.name === 'AbortError') {
    console.error('Dibatalkan.');
    process.exitCode = 130;
    return;
  }
  console.error(`Gagal: ${error.message || error}`);
  process.exitCode = 1;
});
