/* MVC Controller: Tony Studio Generated Files Manager (/files.html) */
'use strict';
const $ = selector => document.querySelector(selector);
const HISTORY_KEY = 'tony-h3-v3-history';

function setTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  $('#theme').textContent = dark ? '☀ โหมดสว่าง' : '☾ โหมดมืด';
  $('#theme').setAttribute('aria-pressed', String(dark));
  try { localStorage.setItem('tony-theme', dark ? 'dark' : 'light'); } catch {}
}
let savedTheme = 'dark';
try { savedTheme = localStorage.getItem('tony-theme') || localStorage.getItem('kendo-theme') || 'dark'; } catch {}
setTheme(savedTheme === 'dark');
$('#theme').onclick = () => setTheme(!document.documentElement.classList.contains('dark'));

function collectVideos(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (typeof value.filename === 'string' && /\.(mp4|webm|mov|mkv)$/i.test(value.filename)) {
    result.push(value);
  } else {
    for (const child of Object.values(value)) collectVideos(child, result);
  }
  return result;
}

function videoUrl(file) {
  return '/api/comfy/view?' + new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || '',
    type: file.type || 'output'
  });
}

function generatedVideos(history) {
  const items = [];
  const seen = new Set();
  for (const [jobId, entry] of Object.entries(history)) {
    const workflow = Array.isArray(entry.prompt) ? entry.prompt[2] : null;
    const prefix = String(workflow?.save?.inputs?.filename_prefix || '');
    if (!workflow?.reference && !prefix.startsWith('video/Tony_H3') && !prefix.startsWith('video/Kendo_H3')) continue;
    const sequence = Number(entry.prompt?.[0]);
    for (const file of collectVideos(entry.outputs)) {
      const url = videoUrl(file);
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ jobId, file, url, sequence: Number.isFinite(sequence) ? sequence : null });
    }
  }
  return items.sort((a, b) => {
    const aHas = a.sequence !== null && Number.isFinite(a.sequence);
    const bHas = b.sequence !== null && Number.isFinite(b.sequence);
    if (aHas && bHas && a.sequence !== b.sequence) return b.sequence - a.sequence;
    if (aHas !== bHas) return aHas ? -1 : 1;
    const byName = String(b.file.filename).localeCompare(String(a.file.filename), undefined, { numeric: true });
    return byName || String(b.jobId).localeCompare(String(a.jobId));
  });
}

function removeFromLocalStorage(url, jobId) {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const next = list.filter(x => x.url !== url && (!jobId || x.id !== jobId));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

function renderDiskStatus(disk) {
  const el = $('#files-disk');
  if (!el || !disk || !disk.total_gb) return;
  el.hidden = false;
  el.textContent = `พื้นที่ว่าง ${disk.free_gb} / ${disk.total_gb} GB`;
}

function bindDeleteAction(btn, card, item) {
  let timer = null;
  btn.onclick = async () => {
    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming');
      btn.textContent = 'ยืนยันลบ?';
      timer = setTimeout(() => {
        btn.classList.remove('confirming');
        btn.textContent = '🗑 ลบ';
      }, 4000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    btn.textContent = 'กำลังลบ…';
    try {
      const res = await TonyApi.deleteVideo({
        filename: item.file.filename,
        subfolder: item.file.subfolder || '',
        type: item.file.type || 'output',
        jobId: item.jobId
      });
      removeFromLocalStorage(item.url, item.jobId);
      card.remove();
      const remaining = $('#generated-files').children.length;
      $('#files-status').textContent = `${remaining} ไฟล์`;
      $('#files-empty').hidden = remaining > 0;
      if (res.disk) renderDiskStatus(res.disk);
    } catch (error) {
      btn.disabled = false;
      btn.classList.remove('confirming');
      btn.textContent = '🗑 ลบ';
      $('#files-status').textContent = error.message || 'ลบไฟล์ไม่สำเร็จ';
    }
  };
}

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'generated-card';
  card.dataset.url = item.url;

  const video = document.createElement('video');
  video.src = item.url;
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';

  const meta = document.createElement('div');
  meta.className = 'generated-meta';

  const name = document.createElement('span');
  name.className = 'generated-name';

  const actions = document.createElement('div');
  actions.className = 'generated-actions';

  const open = document.createElement('a');
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'เปิด ↗';

  const download = document.createElement('a');
  download.textContent = '↓ ดาวน์โหลด';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-btn';
  del.textContent = '🗑 ลบ';

  actions.append(open, download, del);
  meta.append(name, actions);
  card.append(video, meta);
  updateCard(card, item);
  return card;
}

function updateCard(card, item) {
  const name = card.querySelector('.generated-name');
  name.textContent = item.file.filename;
  name.title = item.file.filename;
  const [open, download] = card.querySelectorAll('.generated-actions a');
  open.href = item.url;
  download.href = item.url;
  download.download = item.file.filename;
  const del = card.querySelector('.delete-btn');
  if (del) bindDeleteAction(del, card, item);
}

function render(items) {
  $('#files-empty').hidden = items.length > 0;
  const container = $('#generated-files');
  const existing = new Map([...container.children].map(card => [card.dataset.url, card]));
  const wanted = new Set();
  let cursor = container.firstElementChild;
  for (const item of items) {
    let card = existing.get(item.url);
    if (!card) card = createCard(item);
    else updateCard(card, item);
    wanted.add(item.url);
    if (card === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(card, cursor);
  }
  for (const card of [...container.children]) {
    if (!wanted.has(card.dataset.url)) card.remove();
  }
  $('#files-status').textContent = `${items.length} ไฟล์`;
}

async function refresh() {
  const button = $('#files-refresh');
  button.disabled = true;
  $('#files-status').textContent = 'กำลังโหลด…';
  try {
    const history = await TonyApi.comfy('/history?max_items=200', { cache: 'no-store' });
    render(generatedVideos(history));
  } catch {
    $('#files-status').textContent = 'เชื่อมต่อ ComfyUI ไม่ได้';
    $('#files-empty').hidden = false;
    $('#files-empty').innerHTML = '<div><b>โหลดไฟล์งานไม่สำเร็จ</b><span>ตรวจว่า ComfyUI กำลังทำงาน แล้วลองโหลดใหม่</span></div>';
  } finally {
    button.disabled = false;
  }
}

async function refreshServiceLinks() {
  try {
    const status = await TonyApi.fetchStatus();
    if (status.comfy_url) {
      document.querySelectorAll('.comfy-link').forEach(link => { link.href = status.comfy_url; });
    }
    if (status.disk) renderDiskStatus(status.disk);
  } catch {}
}

$('#files-refresh').onclick = refresh;
void refresh();
void refreshServiceLinks();

// Auto-refresh immediately on SSE generation completion or file deletion
TonyApi.connectEvents({
  onStatus: status => {
    if (status.comfy_url) {
      document.querySelectorAll('.comfy-link').forEach(link => { link.href = status.comfy_url; });
    }
    if (status.disk) renderDiskStatus(status.disk);
  },
  onGeneration: ev => {
    if (ev.event === 'execution_done' || ev.event === 'files_deleted') {
      void refresh();
    }
  }
});

