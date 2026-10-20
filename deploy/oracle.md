# Deploy Unduhin ke Oracle Cloud Always Free

Panduan ini memakai VM ARM Ampere A1 Always Free, Ubuntu 24.04, Docker Compose, Caddy, dan DuckDNS. Hasil akhirnya adalah situs HTTPS di domain gratis.

## 1. Siapkan VM Oracle

1. Masuk ke Oracle Cloud Console dan buat akun Always Free. Verifikasi kartu diperlukan, tetapi resource dalam batas Always Free tidak ditagih.
2. Buat instance Compute baru.
3. Pilih image **Ubuntu 24.04**.
4. Pilih shape **Ampere A1 Flex** dengan 2 OCPU dan 12 GB RAM. Boot volume 47 GB sudah cukup.
5. Simpan SSH key. Catat public IP instance.
6. Jika muncul “out of capacity”, coba availability domain lain atau ulangi beberapa saat lagi.

## 2. Buka port 80 dan 443

Di Oracle Console, buka VCN instance, lalu Security List atau Network Security Group. Tambahkan ingress rule:

- TCP port 80 dari `0.0.0.0/0`
- TCP port 443 dari `0.0.0.0/0`
- SSH port 22 sebaiknya hanya dari IP kamu

Di dalam VM, Oracle Ubuntu memakai iptables. Jalankan:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo apt update
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

Jika `iptables-persistent` sudah ada, cukup jalankan `sudo netfilter-persistent save`.

## 3. Buat domain DuckDNS

1. Login ke https://www.duckdns.org.
2. Buat subdomain, misalnya `unduhin`.
3. Set IP ke public IP VM.
4. Simpan token DuckDNS.

Perbarui DNS dari VM:

```bash
curl "https://www.duckdns.org/update?domains=unduhin&token=TOKEN_DUCKDNS&ip="
```

Respons yang benar adalah `OK`. Untuk menjaga DNS tetap terbarui saat IP berubah, tambahkan cron:

```bash
crontab -e
```

```cron
*/5 * * * * curl -fsS "https://www.duckdns.org/update?domains=unduhin&token=TOKEN_DUCKDNS&ip=" >/dev/null
```

Jangan bagikan token DuckDNS.

## 4. Install Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Keluar dan masuk kembali agar grup `docker` aktif. Verifikasi:

```bash
docker run --rm hello-world
docker compose version
```

## 5. Unggah project

Pilih salah satu:

```bash
git clone REPOSITORY_URL /opt/unduhin
```

atau unggah dari komputer lokal:

```bash
scp -r unduhin ubuntu@IP_VM:/opt/unduhin
```

Lalu:

```bash
cd /opt/unduhin
cp .env.example .env
nano .env
```

Isi minimal:

```env
SITE_ADDRESS=unduhin.duckdns.org
TZ=Asia/Jakarta
```

Jangan memakai `http://` atau `https://` di `SITE_ADDRESS` untuk Caddy. Compose meneruskan nilai ini sebagai alamat situs Caddy.

Siapkan folder cookies:

```bash
mkdir -p cookies
chmod 700 cookies
```

Jika punya cookies Netscape:

```bash
nano cookies/cookies.txt
chmod 600 cookies/cookies.txt
```

## 6. Jalankan

```bash
docker compose up -d --build
```

Build pertama mengunduh Node, ffmpeg, Python, yt-dlp, dan gallery-dl. Di ARM biasanya memerlukan beberapa menit.

Periksa status:

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f caddy
```

Caddy akan meminta sertifikat Let's Encrypt secara otomatis setelah DNS mengarah ke VM dan port 80/443 terbuka. Tunggu 1–3 menit, lalu uji:

```bash
curl -I https://unduhin.duckdns.org
curl -s https://unduhin.duckdns.org/api/health
```

Aplikasi juga bisa diuji dari dalam container:

```bash
docker compose exec app node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>r.text()).then(console.log)"
```

## 7. Update aplikasi

```bash
cd /opt/unduhin
git pull
docker compose up -d --build
```

Untuk memperbarui yt-dlp atau gallery-dl, ubah versi di `Dockerfile`, lalu:

```bash
docker compose build --no-cache app
docker compose up -d
```

## 8. Perawatan

- Cek disk: `df -h` dan `docker system df`.
- File sementara ada di volume `unduhin-tmp`; job lama dibersihkan otomatis oleh aplikasi.
- Backup `.env` dan volume `caddy_data` jika perlu. Sertifikat bisa diterbitkan ulang, tetapi hindari rate limit Let's Encrypt.
- Pantau log: `docker compose logs --tail=100 app`.
- Jangan pernah commit `.env` atau `cookies/cookies.txt`.
- Batasi SSH ke IP kamu dan gunakan SSH key, bukan password.
- Oracle dapat menarik kembali resource Always Free yang idle. Pantau email Oracle dan siapkan snapshot/backup konfigurasi.

## 9. Jika ada masalah

### Situs tidak bisa dibuka

- Pastikan Security List Oracle dan iptables membuka 80/443.
- Pastikan DuckDNS sudah mengarah ke IP yang benar: `dig +short unduhin.duckdns.org`.
- Cek `docker compose logs caddy` untuk error sertifikat.
- Jangan menjalankan layanan lain di port 80/443.

### `TOOL_MISSING`

Image Docker belum memuat yt-dlp, gallery-dl, atau ffmpeg. Build ulang tanpa cache.

### YouTube meminta verifikasi bot

IP datacenter Oracle sering memicu bot check. Cookies server dapat membantu untuk beberapa kasus, tetapi tidak selalu berhasil. Coba lagi nanti atau gunakan sumber lain.

### Instagram atau Facebook gagal

Sebagian besar konten memerlukan cookies server. Ekspor cookies Netscape dari akun khusus, letakkan di `cookies/cookies.txt`, dan pastikan file terbaca oleh container.

### Disk penuh

Kurangi `MAX_FILESIZE_MB`, `JOB_TTL_MIN`, atau `MAX_CONCURRENT`. Periksa volume dengan `docker system df -v`.
