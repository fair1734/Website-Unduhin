const $ = (id) => document.getElementById(id);

const state = {
  preview: null,
  quality: null,
  jobId: null,
  job: null,
  finished: false,
  eventSource: null,
  pollTimer: null,
  pollFailures: 0,
  photos: [],
  selectedPhotos: new Set(),
  previewBusy: false
};

const elements = {
  form: $('download-form'),
  input: $('url-input'),
  paste: $('paste-btn'),
  submit: $('submit-btn'),
  errorBox: $('error-box'),
  errorText: $('error-text'),
  preview: $('preview'),
  thumb: $('preview-thumb'),
  thumbFallback: $('preview-thumb-fallback'),
  source: $('preview-source'),
  kindLabel: $('preview-kind-label'),
  title: $('preview-heading'),
  uploader: $('preview-uploader'),
  duration: $('preview-duration'),
  kindNote: $('preview-kind-note'),
  photoPicker: $('photo-picker'),
  photoList: $('photo-list'),
  photoCount: $('photo-count'),
  photoSelectAll: $('photo-select-all'),
  photoClear: $('photo-clear'),
  qualityWrap: $('quality-wrap'),
  qualityList: $('quality-list'),
  videoBtn: $('download-video-btn'),
  audioBtn: $('download-audio-btn'),
  selectedPhotosBtn: $('download-selected-photos-btn'),
  photoBtn: $('download-photo-btn'),
  progressCard: $('progress-card'),
  progressTitle: $('progress-title'),
  progressPercent: $('progress-percent'),
  progressTrack: document.querySelector('.progress-track'),
  progressFill: $('progress-fill'),
  progressStatus: $('progress-status'),
  progressDetail: $('progress-detail'),
  cancelBtn: $('cancel-btn'),
  resultCard: $('result-card'),
  resultMeta: $('result-meta'),
  resultFiles: $('result-files'),
  zipBtn: $('zip-btn'),
  newBtn: $('new-btn')
};

const icons = {
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m10 9 5 3-5 3V9Z" fill="currentColor"/></svg>',
  audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function makeIcon(name) {
  const span = document.createElement('span');
  span.className = 'file-icon';
  span.innerHTML = icons[name] || icons.video;
  return span;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const size = value / (1024 ** index);
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (!value) return '';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatEta(seconds) {
  const value = Math.round(Number(seconds) || 0);
  if (!value) return '';
  if (value < 60) return `${value} dtk`;
  const minutes = Math.floor(value / 60);
  const secs = value % 60;
  return secs ? `${minutes} mnt ${secs} dtk` : `${minutes} mnt`;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    const error = new Error('Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.');
    error.code = 'NETWORK';
    throw error;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Permintaan gagal diproses. Coba lagi.');
    error.code = payload?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }

  return payload;
}

function showError(message) {
  elements.errorText.textContent = message;
  elements.errorBox.hidden = false;
}

function hideError() {
  elements.errorBox.hidden = true;
  elements.errorText.textContent = '';
}

function setLoading(button, loading) {
  button.dataset.loading = loading ? 'true' : 'false';
  button.disabled = loading;
}

function updatePhotoActions() {
  const isPhoto = state.preview?.kind === 'photo';
  const count = state.photos.length;
  const selected = state.selectedPhotos.size;
  const hasPhotos = count > 0;

  elements.photoPicker.hidden = !isPhoto || !hasPhotos;
  elements.selectedPhotosBtn.hidden = !isPhoto || !hasPhotos;
  elements.selectedPhotosBtn.disabled = state.previewBusy || selected === 0;
  elements.photoBtn.hidden = !isPhoto;
  elements.photoBtn.disabled = state.previewBusy;
  elements.photoSelectAll.disabled = state.previewBusy || !hasPhotos || selected === count;
  elements.photoClear.disabled = state.previewBusy || selected === 0;

  if (hasPhotos) {
    elements.photoCount.textContent = `${count} foto · ${selected} dipilih`;
    elements.selectedPhotosBtn.querySelector('.btn-label').textContent = `Unduh foto terpilih (${selected})`;
    elements.photoBtn.querySelector('.btn-label').textContent = `Unduh semua (${count})`;
    elements.photoBtn.classList.remove('primary-btn');
    elements.photoBtn.classList.add('secondary-btn');
  } else {
    elements.photoCount.textContent = '';
    elements.photoBtn.querySelector('.btn-label').textContent = 'Unduh semua media';
    elements.photoBtn.classList.remove('secondary-btn');
    elements.photoBtn.classList.add('primary-btn');
  }
}

function setPreviewBusy(busy) {
  state.previewBusy = busy;
  elements.videoBtn.disabled = busy;
  elements.audioBtn.disabled = busy;
  elements.photoBtn.disabled = busy;
  elements.selectedPhotosBtn.disabled = busy || state.selectedPhotos.size === 0;

  for (const input of elements.photoList.querySelectorAll('input[type="checkbox"]')) {
    input.disabled = busy;
  }
  if (busy) {
    elements.photoSelectAll.disabled = true;
    elements.photoClear.disabled = true;
  } else {
    updatePhotoActions();
  }
}

function scrollTo(element) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

function stopTracking() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

function cancelActiveJob() {
  const id = state.jobId;
  if (!id || state.finished) return;
  fetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).catch(() => {});
}

function deleteFinishedJob() {
  const id = state.jobId;
  if (!id || !state.finished) return;
  fetch(`/api/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
}

function resetOutputs() {
  stopTracking();
  state.jobId = null;
  state.job = null;
  state.finished = false;
  elements.progressCard.hidden = true;
  elements.resultCard.hidden = true;
  elements.resultFiles.replaceChildren();
  elements.zipBtn.hidden = true;
  elements.zipBtn.removeAttribute('href');
  hideError();
  setPreviewBusy(false);
}

function resetAll() {
  resetOutputs();
  state.preview = null;
  state.quality = null;
  state.photos = [];
  state.selectedPhotos.clear();
  elements.photoList.replaceChildren();
  elements.photoPicker.hidden = true;
  elements.preview.hidden = true;
  elements.input.value = '';
  elements.form.querySelector('.btn-label').textContent = 'Ambil media';
  setLoading(elements.submit, false);
  elements.input.focus();
}

function syncPhotoInputs() {
  for (const input of elements.photoList.querySelectorAll('input[type="checkbox"]')) {
    const index = Number(input.dataset.index);
    const checked = state.selectedPhotos.has(index);
    input.checked = checked;
    input.closest('.photo-option')?.classList.toggle('is-selected', checked);
  }
  updatePhotoActions();
}

function renderPhotoList(photos) {
  elements.photoList.replaceChildren();

  for (const photo of photos) {
    const label = document.createElement('label');
    label.className = 'photo-option';
    label.title = photo.width && photo.height
      ? `Foto ${photo.index} · ${photo.width}×${photo.height}`
      : `Foto ${photo.index}`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.index = String(photo.index);
    input.checked = state.selectedPhotos.has(photo.index);
    input.setAttribute('aria-label', `Pilih foto ${photo.index}`);
    input.addEventListener('change', () => {
      if (input.checked) {
        state.selectedPhotos.add(photo.index);
      } else {
        state.selectedPhotos.delete(photo.index);
      }
      label.classList.toggle('is-selected', input.checked);
      updatePhotoActions();
    });

    const thumb = document.createElement('span');
    thumb.className = 'photo-thumb';

    const image = document.createElement('img');
    image.src = photo.previewUrl;
    image.alt = `Foto ${photo.index}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => {
      image.hidden = true;
      label.classList.add('is-missing');
    };

    const badge = document.createElement('span');
    badge.className = 'photo-index';
    badge.textContent = String(photo.index);

    thumb.append(image, badge);
    label.append(input, thumb);
    label.classList.toggle('is-selected', input.checked);
    elements.photoList.append(label);
  }
}

function renderPreview(data) {
  state.preview = data;
  elements.preview.hidden = false;
  elements.resultCard.hidden = true;
  elements.progressCard.hidden = true;

  elements.source.textContent = data.source || 'Media';
  elements.title.textContent = data.title || 'Media';
  elements.uploader.textContent = data.uploader ? `oleh ${data.uploader}` : '';
  elements.uploader.hidden = !data.uploader;
  elements.duration.textContent = formatDuration(data.duration);
  elements.duration.hidden = !data.duration;

  if (data.thumbnail) {
    elements.thumb.src = data.thumbnail;
    elements.thumb.hidden = false;
    elements.thumbFallback.hidden = true;
    elements.thumb.onerror = () => {
      elements.thumb.hidden = true;
      elements.thumbFallback.hidden = false;
    };
  } else {
    elements.thumb.removeAttribute('src');
    elements.thumb.hidden = true;
    elements.thumbFallback.hidden = false;
  }

  const isPhoto = data.kind === 'photo';
  const isAudio = data.kind === 'audio';
  const photos = isPhoto && Array.isArray(data.photos)
    ? data.photos.filter((photo) => photo && Number.isInteger(photo.index) && photo.previewUrl)
    : [];
  state.photos = photos;
  state.selectedPhotos = new Set(photos.map((photo) => photo.index));
  renderPhotoList(photos);

  elements.kindLabel.textContent = isPhoto ? 'Galeri foto' : isAudio ? 'Audio siap diunduh' : 'Video siap diunduh';
  elements.kindNote.hidden = !isPhoto && !isAudio;
  elements.kindNote.textContent = isPhoto
    ? (photos.length
      ? 'Pilih foto yang ingin diunduh, atau unduh semua sekaligus.'
      : 'Postingan ini berisi foto atau beberapa media. Semua media akan diunduh sekaligus.')
    : 'Konten ini berupa audio. Unduh dalam format MP3.';
  elements.qualityWrap.hidden = isPhoto || isAudio;
  elements.videoBtn.hidden = isPhoto || isAudio;
  elements.audioBtn.hidden = isPhoto;
  elements.photoBtn.hidden = !isPhoto;

  elements.audioBtn.classList.toggle('primary-btn', isAudio);
  elements.audioBtn.classList.toggle('secondary-btn', !isAudio);
  elements.audioBtn.querySelector('.btn-label').textContent = isAudio ? 'Unduh MP3' : 'MP3';

  elements.qualityList.replaceChildren();
  state.quality = isPhoto || isAudio ? null : data.defaultQuality ?? 0;

  if (!isPhoto && !isAudio) {
    const qualities = Array.isArray(data.qualities) ? data.qualities : [];
    for (const quality of qualities) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quality-btn';
      button.dataset.height = String(quality.height || 0);
      button.setAttribute('aria-pressed', String((quality.height || 0) === state.quality));

      const label = document.createElement('strong');
      label.textContent = quality.label;
      const detail = document.createElement('span');
      detail.textContent = quality.filesize ? formatBytes(quality.filesize) : String(quality.ext || '').toUpperCase();
      button.append(label, detail);

      button.addEventListener('click', () => {
        state.quality = quality.height || 0;
        for (const other of elements.qualityList.querySelectorAll('.quality-btn')) {
          const active = other === button;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-pressed', String(active));
        }
        updateVideoLabel(quality);
      });

      if ((quality.height || 0) === state.quality) button.classList.add('is-active');
      elements.qualityList.append(button);
    }

    if (!qualities.length) {
      elements.qualityWrap.hidden = true;
    }
    const selected = qualities.find((quality) => (quality.height || 0) === state.quality) || qualities[0];
    updateVideoLabel(selected);
  }

  setPreviewBusy(false);
  hideError();
  scrollTo(elements.preview);
}

function updateVideoLabel(quality) {
  const label = elements.videoBtn.querySelector('.btn-label');
  if (quality && quality.height > 0) {
    label.textContent = `Unduh ${quality.label}`;
  } else {
    label.textContent = 'Unduh video';
  }
}

function progressDetail(job) {
  const parts = [];
  const progress = job.progress || {};
  const filesDone = Number(progress.filesDone) || 0;
  const filesTotal = Number(progress.filesTotal) || 0;
  if (filesDone && filesTotal) {
    parts.push(`Foto ${Math.min(filesDone, filesTotal)}/${filesTotal}`);
  }
  if (progress.downloadedBytes) parts.push(formatBytes(progress.downloadedBytes));
  if (progress.totalBytes) parts.push(`dari ${formatBytes(progress.totalBytes)}`);
  if (progress.speed) parts.push(`${formatBytes(progress.speed)}/dtk`);
  if (progress.eta) parts.push(`± ${formatEta(progress.eta)}`);
  return parts.join(' · ');
}

function renderProgress(job) {
  state.job = job;
  elements.progressCard.hidden = false;
  elements.resultCard.hidden = true;
  elements.progressTitle.textContent = job.title || 'Menyiapkan unduhan...';

  const percent = job.progress?.percent;
  const indeterminate = percent === null || percent === undefined;
  elements.progressFill.classList.toggle('is-indeterminate', indeterminate);
  elements.progressFill.style.width = indeterminate ? '38%' : `${Math.min(100, Math.max(0, percent))}%`;
  elements.progressPercent.textContent = indeterminate ? '···' : `${Math.round(percent)}%`;
  elements.progressTrack.setAttribute('aria-valuenow', indeterminate ? '0' : String(Math.round(percent)));

  if (job.status === 'queued') {
    elements.progressStatus.textContent = job.queuePosition ? `Menunggu antrean · posisi ${job.queuePosition}` : 'Menunggu antrean...';
  } else if (job.status === 'processing') {
    const progress = job.progress || {};
    const done = Number(progress.filesDone) || 0;
    const total = Number(progress.filesTotal) || 0;
    elements.progressStatus.textContent = total
      ? `Mengunduh foto ${Math.min(done + 1, total)} dari ${total}...`
      : 'Mengambil daftar foto...';
  } else if (job.status === 'downloading') {
    elements.progressStatus.textContent = 'Mengunduh media...';
  } else if (job.status === 'cancelling') {
    elements.progressStatus.textContent = 'Membatalkan unduhan...';
  } else {
    elements.progressStatus.textContent = 'Menyelesaikan...';
  }

  elements.progressDetail.textContent = progressDetail(job);
  elements.cancelBtn.hidden = ['ready', 'failed', 'cancelled'].includes(job.status);
  elements.cancelBtn.disabled = job.status === 'cancelling';
}

function finishJob(job) {
  state.finished = true;
  stopTracking();
  setPreviewBusy(false);

  if (job.status === 'ready') {
    elements.progressCard.hidden = true;
    renderResult(job);
    return;
  }

  elements.progressCard.hidden = true;
  if (job.status === 'failed') {
    showError(job.error?.message || 'Unduhan gagal. Coba lagi.');
  } else if (job.status === 'cancelled') {
    showError('Unduhan dibatalkan. Kamu bisa mencoba lagi kapan saja.');
  }
  scrollTo(elements.errorBox);
}

function renderResult(job) {
  elements.resultCard.hidden = false;
  elements.resultFiles.replaceChildren();
  elements.zipBtn.hidden = !job.zipUrl;
  if (job.zipUrl) elements.zipBtn.href = job.zipUrl;

  const total = job.files.reduce((sum, file) => sum + file.size, 0);
  const kind = job.format === 'photo' ? 'Foto' : job.format === 'audio' ? 'Audio' : 'Video';
  elements.resultMeta.textContent = `${job.files.length} file · ${formatBytes(total)} · ${kind}. File tersedia sementara, unduh sekarang.`;

  if (job.files.length === 1 && job.files[0].type !== 'image') {
    const file = job.files[0];
    const row = document.createElement('div');
    row.className = 'single-file';

    const main = document.createElement('div');
    main.className = 'single-file-main';
    const icon = document.createElement('span');
    icon.className = 'single-file-icon';
    icon.innerHTML = file.type === 'audio' ? icons.audio : icons.video;
    const text = document.createElement('div');
    text.className = 'single-file-text';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const size = document.createElement('span');
    size.textContent = `${formatBytes(file.size)} · ${file.type === 'audio' ? 'MP3' : 'Video'}`;
    text.append(name, size);
    main.append(icon, text);

    const link = document.createElement('a');
    link.className = 'secondary-btn';
    link.href = `${file.url}&download=1`;
    link.setAttribute('download', file.name);
    link.innerHTML = icons.download;
    link.append(document.createTextNode('Unduh'));
    row.append(main, link);
    elements.resultFiles.append(row);
    scrollTo(elements.resultCard);
    return;
  }

  for (const file of job.files) {
    const card = document.createElement('article');
    card.className = 'file-card';

    const preview = document.createElement('div');
    preview.className = 'file-preview';

    if (file.type === 'image') {
      const link = document.createElement('a');
      link.href = file.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('aria-label', `Buka ${file.name}`);
      const image = document.createElement('img');
      image.src = file.url;
      image.alt = file.name;
      image.loading = 'lazy';
      link.append(image);
      preview.append(link);
    } else {
      preview.classList.add('is-icon');
      preview.append(makeIcon(file.type === 'audio' ? 'audio' : 'video'));
    }

    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    name.title = file.name;

    const link = document.createElement('a');
    link.className = 'file-download';
    link.href = `${file.url}&download=1`;
    link.setAttribute('download', file.name);
    link.setAttribute('aria-label', `Unduh ${file.name}`);
    link.innerHTML = icons.download;

    info.append(name, link);
    card.append(preview, info);
    elements.resultFiles.append(card);
  }

  scrollTo(elements.resultCard);
}

async function pollJob(id) {
  try {
    const payload = await request(`/api/jobs/${id}`);
    state.pollFailures = 0;
    renderProgress(payload.job);
    if (['ready', 'failed', 'cancelled'].includes(payload.job.status)) {
      finishJob(payload.job);
      return;
    }
    state.pollTimer = setTimeout(() => pollJob(id), 1500);
  } catch (error) {
    state.pollFailures += 1;
    if (state.pollFailures >= 3) {
      finishJob({
        status: 'failed',
        error: { message: error.message || 'Koneksi ke server terputus.' }
      });
      return;
    }
    state.pollTimer = setTimeout(() => pollJob(id), 2000);
  }
}

function startTracking(id) {
  stopTracking();
  state.pollFailures = 0;

  if (!('EventSource' in window)) {
    state.pollTimer = setTimeout(() => pollJob(id), 1000);
    return;
  }

  const source = new EventSource(`/api/jobs/${id}/events`);
  state.eventSource = source;

  source.addEventListener('update', (event) => {
    if (!event.data) return;
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    renderProgress(payload);
    if (['ready', 'failed', 'cancelled'].includes(payload.status)) {
      finishJob(payload);
    }
  });

  source.onerror = () => {
    source.close();
    if (state.eventSource === source) state.eventSource = null;
    if (!state.finished) {
      state.pollTimer = setTimeout(() => pollJob(id), 800);
    }
  };
}

async function startJob(format, photoIndices = null) {
  if (!state.preview) return;
  const preview = state.preview;
  const height = format === 'video' ? state.quality : 0;

  deleteFinishedJob();
  state.jobId = null;
  state.finished = false;
  setPreviewBusy(true);
  hideError();
  elements.progressCard.hidden = false;
  elements.resultCard.hidden = true;
  elements.progressTitle.textContent = preview.title || 'Menyiapkan unduhan...';
  elements.progressStatus.textContent = 'Mengirim permintaan...';
  elements.progressPercent.textContent = '···';
  elements.progressFill.classList.add('is-indeterminate');
  elements.progressFill.style.width = '38%';
  elements.progressDetail.textContent = '';
  scrollTo(elements.progressCard);

  try {
    const body = {
      url: preview.url,
      format,
      height,
      title: preview.title
    };
    if (Array.isArray(photoIndices)) body.photoIndices = photoIndices;

    const payload = await request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    state.jobId = payload.job.id;
    state.finished = false;
    state.job = payload.job;
    renderProgress(payload.job);
    startTracking(payload.job.id);
  } catch (error) {
    elements.progressCard.hidden = true;
    setPreviewBusy(false);
    showError(error.message);
    scrollTo(elements.errorBox);
  }
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = elements.input.value.trim();
  if (!url) {
    showError('Tempel tautan terlebih dahulu.');
    elements.input.focus();
    return;
  }

  cancelActiveJob();
  deleteFinishedJob();
  resetOutputs();
  elements.preview.hidden = true;
  elements.form.querySelector('.btn-label').textContent = 'Mengambil media...';
  setLoading(elements.submit, true);

  try {
    const payload = await request('/api/resolve', {
      method: 'POST',
      body: JSON.stringify({ url })
    });
    renderPreview({ ...payload.data, url });
  } catch (error) {
    showError(error.message);
    elements.errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } finally {
    setLoading(elements.submit, false);
    elements.form.querySelector('.btn-label').textContent = 'Ambil media';
  }
});

elements.paste.addEventListener('click', async () => {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    elements.input.focus();
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      elements.input.value = text.trim();
      elements.input.focus();
      hideError();
    }
  } catch {
    elements.input.focus();
    elements.input.select();
  }
});

function startPhotoJob(mode) {
  if (!state.preview || state.preview.kind !== 'photo') return;

  if (mode === 'selected') {
    const indices = [...state.selectedPhotos].sort((a, b) => a - b);
    if (indices.length === 0) {
      showError('Pilih minimal satu foto.');
      scrollTo(elements.errorBox);
      return;
    }
    startJob('photo', indices);
    return;
  }

  startJob('photo');
}

elements.videoBtn.addEventListener('click', () => startJob('video'));
elements.audioBtn.addEventListener('click', () => startJob('audio'));
elements.selectedPhotosBtn.addEventListener('click', () => startPhotoJob('selected'));
elements.photoBtn.addEventListener('click', () => startPhotoJob('all'));

elements.photoSelectAll.addEventListener('click', () => {
  state.selectedPhotos = new Set(state.photos.map((photo) => photo.index));
  syncPhotoInputs();
});

elements.photoClear.addEventListener('click', () => {
  state.selectedPhotos.clear();
  syncPhotoInputs();
});

elements.cancelBtn.addEventListener('click', async () => {
  const id = state.jobId;
  if (!id || state.finished) return;
  elements.cancelBtn.disabled = true;
  try {
    const payload = await request(`/api/jobs/${id}/cancel`, { method: 'POST' });
    renderProgress(payload.job);
    if (['cancelled', 'ready', 'failed'].includes(payload.job.status)) finishJob(payload.job);
  } catch (error) {
    showError(error.message);
    elements.cancelBtn.disabled = false;
  }
});

elements.newBtn.addEventListener('click', () => {
  deleteFinishedJob();
  resetAll();
  scrollTo(elements.form);
});

window.addEventListener('beforeunload', () => {
  stopTracking();
});
