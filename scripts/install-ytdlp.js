
const fs = require('node:fs/promises');
const path = require('node:path');

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

  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(temp, data);
  await fs.rename(temp, target);
  await fs.chmod(target, 0o755);

  console.log('yt-dlp berhasil diunduh.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
