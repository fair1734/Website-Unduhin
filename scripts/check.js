const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json',
  'src/server.js',
  'src/app.js',
  'src/config.js',
  'src/routes/api.js',
  'src/services/jobs.js',
  'src/services/resolver.js',
  'src/services/ytdlp.js',
  'src/services/gallerydl.js',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/404.html',
  'public/favicon.svg',
  'Dockerfile',
  'docker-compose.yml',
  'deploy/Caddyfile',
  'deploy/oracle.md',
  '.env.example'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`File wajib tidak ditemukan:\n${missing.join('\n')}`);
  process.exit(1);
}

function collect(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'tmp') continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(target, files);
    } else if (target.endsWith('.js')) {
      files.push(target);
    }
  }
  return files;
}

const files = [
  ...collect(path.join(root, 'src')),
  ...collect(path.join(root, 'public')),
  ...collect(path.join(root, 'scripts')),
  ...collect(path.join(root, 'test'))
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Kesalahan sintaks di ${path.relative(root, file)}:\n${result.stderr}`);
    process.exit(1);
  }
}

console.log(`Pemeriksaan kode OK (${files.length} file).`);
