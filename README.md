# Unduhin

Pengunduh video, audio, dan foto tanpa watermark dari tautan media sosial. Tempel URL, pilih kualitas, lalu unduh langsung dari browser.

## Fitur

- Video tanpa watermark untuk platform yang menyediakan sumber bersih, termasuk TikTok.
- Pilihan kualitas video hingga 4K jika tersedia.
- Ekstraksi audio ke MP3.
- Unduhan foto, carousel, dan galeri sebagai file terpisah atau ZIP.
- UI responsif berbahasa Indonesia, progres real-time lewat SSE, dan pembatalan job.
- Antrean job, batas ukuran/durasi, pembersihan file otomatis, dan rate limit.
- Domain allowlist dan proteksi alamat privat untuk mengurangi risiko SSRF.

## Platform

Didukung melalui `yt-dlp` dan `gallery-dl`: TikTok, Douyin, YouTube, X/Twitter, Facebook, Instagram, Threads, Vimeo, Dailymotion, Twitch, Reddit, Pinterest, Snapchat, Likee, Rumble, Odysee, SoundCloud, Bilibili, VK, LinkedIn, Tumblr, Imgur, 9GAG, Streamable, CapCut, Kuaishou, Weibo, Ixigua, Niconico, Bandcamp, BitChute, dan TED.

Tidak semua konten publik bisa diakses tanpa login. Instagram dan Facebook sering memerlukan cookies server untuk postingan tertentu. YouTube dari IP datacenter dapat meminta verifikasi bot.

## Cara kerja

Server tidak mengirim URL media langsung ke browser karena URL tersebut sering terikat pada IP dan cookies server. Alurnya:

1. `POST /api/resolve` mengambil metadata dan daftar kualitas memakai `yt-dlp`.
2. Untuk TikTok `/photo/` dan slideshow `/video/`, server membaca data foto dari embed publik TikTok, bukan `gallery-dl`.
3. `POST /api/jobs` membuat job unduhan; job foto TikTok dapat menyertakan `photoIndices`.
4. Server mengunduh ke `tmp/`, menggabungkan video/audio dengan `ffmpeg` bila perlu, atau mengambil foto dengan service foto TikTok/`gallery-dl`.
5. Browser memantau progres lewat SSE dan mengunduh hasil dari endpoint file atau ZIP.
6. File dihapus otomatis setelah TTL.

## Menjalankan lokal

Kebutuhan: Node.js 22.12+, Python 3, `ffmpeg`, `yt-dlp`, dan `gallery-dl`.

### Linux biasa

```bash
sudo apt update
sudo apt install -y ffmpeg python3 python3-pip
python3 -m pip install --user yt-dlp==2026.08.19 gallery-dl==1.32.17
npm install
cp .env.example .env
npm start
```

Buka `http://localhost:3000`.

### Android/Acode

Penyimpanan Android memblokir symlink npm. Gunakan `--bin-links=false`.

```bash
apk add ffmpeg python3 py3-pip
python3 -m pip install --break-system-packages --no-cache-dir yt-dlp==2026.08.19 gallery-dl==1.32.17
npm install --bin-links=false
cp .env.example .env
npm start
```

Jika `pip` menolak instalasi sebagai root, opsi `--break-system-packages` di atas sudah menanganinya. Alternatif yang lebih rapi adalah membuat virtualenv di luar folder project.

### Perintah

```bash
npm start
npm run dev
npm test
npm run check
```

`npm run check` memeriksa sintaks seluruh file JavaScript dan keberadaan file wajib.

## CLI

```bash
npm run cli -- "URL"
npm run cli -- "URL" --audio
npm run cli -- "URL" --photo
npm run cli -- "URL" --photo-select 1,3,5-7
npm run cli -- "URL" --photo-all
```

`--photo` menampilkan daftar foto bernomor beserta dimensinya, lalu menu pilih nomor, unduh semua, atau batal jika dijalankan di terminal interaktif. Input nomor yang tidak valid akan ditanyakan ulang. Tanpa terminal interaktif, semua foto dipilih. `--photo-select` menerima nomor tunggal, daftar, dan rentang seperti `1`, `1,3,5`, `2-6`, atau `1,3,5-7,10`. `--photo-all` melewati menu. Opsi `-o`/`--output` mengatur folder hasil.

## Konfigurasi

Salin `.env.example` menjadi `.env`, lalu sesuaikan:

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `SITE_ADDRESS` | `http://localhost:3000` | Alamat publik; dipakai untuk log dan Caddy |
| `PORT` | `3000` | Port aplikasi |
| `MAX_CONCURRENT` | `2` | Job yang diproses bersamaan |
| `MAX_QUEUE` | `12` | Batas antrean |
| `JOB_TTL_MIN` | `60` | Umur file hasil di server |
| `MAX_FILESIZE_MB` | `500` | Batas ukuran file |
| `MAX_DURATION_MIN` | `120` | Batas durasi video/audio |
| `MAX_PHOTOS` | `40` | Batas jumlah foto per job |
| `MIN_FREE_DISK_MB` | `2048` | Sisa disk minimum sebelum menolak job |
| `ALLOW_ALL_SITES` | `false` | Izinkan domain apa pun; hanya untuk pengujian |
| `COOKIES_FILE` | `cookies/cookies.txt` | Lokasi cookies Netscape |
| `RATE_LIMIT_MAX` | `40` | Batas request POST API per jendela |
| `RATE_LIMIT_WINDOW_MIN` | `10` | Panjang jendela rate limit dalam menit |
| `YTDLP_POT_BASE_URL` | kosong | Base URL server bgutil PO token, opsional |
| `YTDLP_EXTRA_ARGS` | kosong | Argumen tambahan `yt-dlp`, dipisah spasi |

Jangan set `ALLOW_ALL_SITES=true` di server publik. Opsi itu melemahkan allowlist domain.

## Cookies server

Untuk konten yang memerlukan login:

1. Ekspor cookies dari browser dalam format Netscape `cookies.txt`.
2. Simpan sebagai `cookies/cookies.txt`.
3. Batasi akses: `chmod 600 cookies/cookies.txt`.
4. Jangan commit file cookies. File ini sudah masuk `.gitignore`.

Server membaca file cookies saat job berjalan, jadi restart tidak wajib setelah mengganti file. Cookies adalah kredensial akun; gunakan akun khusus dan pahami risikonya.

## Docker

```bash
cp .env.example .env
mkdir -p cookies
docker compose up -d --build
docker compose logs -f
```

Compose menjalankan aplikasi dan Caddy. Caddy menerbitkan sertifikat HTTPS otomatis jika `SITE_ADDRESS` berupa domain yang mengarah ke server dan port 80/443 terbuka. Untuk uji lokal tanpa domain, set `SITE_ADDRESS=:80` lalu buka `http://localhost`.

File sementara disimpan di volume `unduhin-tmp`. Cookies dipasang read-only dari `./cookies`.

## Deploy gratis

Panduan langkah demi langkah untuk Oracle Cloud Always Free, DuckDNS, Docker, dan Caddy ada di [deploy/oracle.md](deploy/oracle.md).

Ringkasnya:

1. Buat VM Ampere A1 Always Free dengan Ubuntu 24.04.
2. Arahkan subdomain DuckDNS ke IP publik VM.
3. Buka port 80/443 di Security List Oracle dan firewall VM.
4. Clone project, isi `.env`, lalu `docker compose up -d --build`.
5. Caddy mengurus TLS; aplikasi berjalan di belakang reverse proxy.

## API

| Metode | Endpoint | Keterangan |
| --- | --- | --- |
| `GET` | `/api/health` | Status server dan versi tool |
| `POST` | `/api/resolve` | `{ "url": "..." }`; metadata dan kualitas |
| `POST` | `/api/jobs` | `{ "url", "format", "height", "title", "photoIndices" }`; buat job |
| `GET` | `/api/jobs/:id` | Status job |
| `GET` | `/api/jobs/:id/events` | SSE progres |
| `GET` | `/api/jobs/:id/file?i=0` | File hasil; tambah `download=1` untuk attachment |
| `GET` | `/api/jobs/:id/zip` | Arsip ZIP untuk banyak file |
| `POST` | `/api/jobs/:id/cancel` | Batalkan job |
| `DELETE` | `/api/jobs/:id` | Hapus job dan file |

Format job: `video`, `audio`, atau `photo`. `height` hanya dipakai untuk video; `0` berarti pilihan terbaik.

Untuk job foto TikTok, `photoIndices` adalah array nomor foto berbasis 1, misalnya `[1, 3, 5]`. Hilangkan field tersebut untuk mengunduh semua foto. Array kosong ditolak. Respons resolve menyertakan `photoCount`, `maxSelectable`, dan `photos` berisi `index`, `previewUrl`, `width`, serta `height`. Nama file mempertahankan nomor asli, misalnya `001_foto.jpg`.

Job foto TikTok memakai embed publik dan tidak menerima cookies atau melewati CAPTCHA/WAF. Jika TikTok menampilkan verifikasi bot, API mengembalikan error `BOT_CHECK`; jika akses ditolak, error `ACCESS_DENIED`.

## Batasan dan catatan

- Konten privat, geo-blocked, atau yang memerlukan login tidak dijamin berhasil.
- YouTube dapat memblokir IP datacenter dengan verifikasi bot. Cookies dan PO token dapat membantu, tetapi tidak menjamin.
- Klaim “tanpa watermark” bergantung pada sumber yang disediakan platform. Jika tidak ada sumber bersih, job gagal daripada menghasilkan file berwatermark.
- Foto TikTok diambil dari embed publik. Perubahan struktur embed atau WAF TikTok dapat membuat job foto gagal; server tidak mencoba melewati verifikasi.
- Jangan gunakan layanan ini untuk melanggar hak cipta atau ketentuan platform. Simpan hanya konten yang kamu berhak miliki.
- Server publik sebaiknya memakai HTTPS, pembatasan firewall, dan pemantauan disk.

## Lisensi

MIT.
