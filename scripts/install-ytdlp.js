const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  if (process.env.VERCEL !== '1') {
    console.log('Bukan build Vercel, pemasangan dilewati.');
    return;
  }

  const binDir = path.resolve(__dirname, '..', 'bin');
  const target = path.join(binDir, 'yt-dlp');
  const temp = `${target}.download`;

  await fs.mkdir(binDir, { recursive: true });

  const response = await fetch(
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
  );

  if (!response.ok) {
    throw new Error(`Gagal mengunduh yt-dlp: HTTP ${response.status}`);
  }

  await fs.writeFile(temp, Buffer.from(await response.arrayBuffer()));
  await fs.rename(temp, target);
  await fs.chmod(target, 0o755);

  const python = spawnSync('python3', ['--version'], {
    encoding: 'utf8'
  });

  console.log(
    python.status === 0
      ? `Python tersedia: ${(python.stdout || python.stderr).trim()}`
      : 'Python3 tidak tersedia saat build; gallery-dl belum dipasang.'
  );

  console.log('yt-dlp berhasil diunduh.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});