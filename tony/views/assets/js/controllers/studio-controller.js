/* MVC Controller: Tony Studio Main Video Generator (:3000) */
'use strict';
const $ = s => document.querySelector(s);
const media = { image: [], video: [], audio: [] };
const limits = { image: 9, video: 1, audio: 3 };
const extensions = {
  image: /\.(png|jpe?g|webp)$/i,
  video: /\.(mp4|webm|mov)$/i,
  audio: /\.(wav|mp3|flac|ogg|m4a)$/i
};

let ready = false;
let submitting = false;
let lastSeed = null;
const jobs = new Map();

let genState = {
  active: false,
  startedAtMs: null,
  etaSeconds: null,
  etaUpdatedAtMs: null,
  phaseLabel: '',
  percent: 0,
  step: 0,
  maxSteps: 0
};

let logStream = null;
let logOffset = 0;
let logRawText = '';
let logGpuText = '';

function formatDurationText(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return 'กำลังประเมินเวลา…';
  }
  const sec = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins === 0) return `${rem} วินาที`;
  return `${mins} นาที ${String(rem).padStart(2, '0')} วินาที`;
}

function formatClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    return `${hrs}:${String(mins % 60).padStart(2, '0')}:${String(rem).padStart(2, '0')} (${hrs} ชม. ${mins % 60} นาที)`;
  }
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')} (${mins} นาที ${rem} วินาที)`;
}

function updateGenTimerDisplay() {
  if (!genState.active || $('#generation-card').hidden) return;
  const now = Date.now();
  const elapsedSec = genState.startedAtMs ? Math.max(0, Math.floor((now - genState.startedAtMs) / 1000)) : 0;
  $('#gen-elapsed').textContent = formatClock(elapsedSec);

  if (genState.etaSeconds !== null && genState.etaUpdatedAtMs !== null) {
    const passedSinceEta = Math.max(0, Math.floor((now - genState.etaUpdatedAtMs) / 1000));
    const remaining = Math.max(1, genState.etaSeconds - passedSinceEta);
    $('#gen-eta').textContent = '~' + formatDurationText(remaining);
  } else {
    $('#gen-eta').textContent = 'กำลังประเมินเวลา…';
  }
}

setInterval(updateGenTimerDisplay, 1000);

function renderGenerationCard(g) {
  if (!g) return;
  const activePhases = new Set(['loading', 'conditioning', 'sampling', 'decoding', 'saving', 'running']);
  const isActive = activePhases.has(g.phase) || submitting || jobs.size > 0;

  if (g.queue_active !== undefined && g.queue_pending !== undefined) {
    const activeCount = Number(g.queue_active) || 0;
    const pendingCount = Number(g.queue_pending) || 0;
    $('#queue-active-count').textContent = String(activeCount);
    $('#queue-pending-count').textContent = String(pendingCount);
    $('.queue-item.active').classList.toggle('has-jobs', activeCount > 0);
    $('.queue-item.pending').classList.toggle('has-jobs', pendingCount > 0);
    $('#queue-state').textContent = activeCount || pendingCount ? `ทั้งหมด ${activeCount + pendingCount} งาน` : 'คิวว่าง';
  }

  if (g.event === 'files_deleted' && g.deleted) {
    removeDeletedFromLocalHistory(g.deleted.filename, g.deleted.job_id);
    if (g.deleted.disk) renderDisk(g.deleted.disk);
    return;
  }

  if (g.event === 'execution_done' && g.completed_prompt_id) {
    void finalizeJobResult(g.completed_prompt_id);
  }

  if (!isActive && g.phase !== 'loading' && g.phase !== 'sampling') {
    genState.active = false;
    $('#generation-card').hidden = true;
    return;
  }

  // Keep local uploading/queued status until ComfyUI WebSocket reports an active phase
  if (!activePhases.has(g.phase) && g.phase !== 'done' && (submitting || jobs.size > 0)) {
    updateGenTimerDisplay();
    return;
  }

  genState.active = true;
  $('#generation-card').hidden = false;
  if (g.started_at) {
    genState.startedAtMs = g.started_at * 1000;
  } else if (!genState.startedAtMs) {
    genState.startedAtMs = Date.now();
  }

  const pct = Math.min(100, Math.max(0, Math.round(Number(g.percent) || 0)));
  genState.percent = pct;
  $('#gen-phase-label').textContent = g.phase_label || 'กำลังสร้างวิดีโอ…';
  $('#gen-percent').textContent = `${pct}%`;
  $('#gen-progress-bar').value = pct;

  const stepBadge = $('#gen-step-badge');
  if (g.max_steps > 0) {
    stepBadge.hidden = false;
    stepBadge.textContent = `Step ${g.step || 0}/${g.max_steps} (${Math.round(g.step_percent || 0)}%)`;
  } else {
    stepBadge.hidden = true;
  }

  if (g.eta_seconds !== null && g.eta_seconds !== undefined) {
    genState.etaSeconds = Number(g.eta_seconds);
    genState.etaUpdatedAtMs = Date.now();
  } else if (g.phase === 'loading' || g.phase === 'conditioning') {
    genState.etaSeconds = null;
  }

  updateGenTimerDisplay();
}

function renderDisk(disk) {
  const badge = $('#disk-status');
  if (!badge || !disk || !disk.total_gb) return;
  badge.hidden = false;
  badge.textContent = `DISK · ว่าง ${disk.free_gb} GB`;
  badge.title = `ใช้ไป ${disk.used_gb} GB จาก ${disk.total_gb} GB (${disk.percent}%)`;
}

function renderActiveModels(activeModels) {
  if (!Array.isArray(activeModels) || !activeModels.length) return;
  const select = $('#model-select');
  if (!select || select.disabled) return;
  for (const opt of select.options) {
    if (opt.value === 'original' || opt.value === 'singularity') {
      opt.hidden = !activeModels.includes(opt.value);
      opt.disabled = !activeModels.includes(opt.value);
    }
  }
  if (select.selectedOptions[0]?.disabled) {
    const firstValid = [...select.options].find(o => !o.disabled);
    if (firstValid) select.value = firstValid.value;
  }
}

function renderRuntime(value) {
  const runtime = value || globalThis.TONY_LOCAL_RUNTIME || {};
  const modelSelect = $('#model-select');
  if (runtime.model_profile === 'quality') {
    document.title = 'Tony Studio | Pro6000 H3 Quality';
    document.querySelector('header>small').textContent = 'MiniMax H3 · Pro6000 Quality';
    modelSelect.replaceChildren(
      Object.assign(document.createElement('option'), {
        value: 'original-bf16',
        textContent: 'Original Ref2VA · BF16 66.3 GB'
      })
    );
    modelSelect.value = 'original-bf16';
    modelSelect.disabled = true;
    $('#model-hint').textContent = 'BF16 · RTX PRO 6000 96GB';
  }
  const badge = $('#attention-status');
  const sage = runtime.sage && typeof runtime.sage === 'object' ? runtime.sage : {};
  const active = sage.active === true || runtime.global_sage === true || runtime.sage === true;
  badge.textContent = `ATTENTION · ${runtime.attention || (active ? 'Sage Global · ACTIVE' : 'Native · FALLBACK')}`;
  badge.classList.toggle('active', active);
  badge.classList.toggle('fallback', !active);
  badge.title = sage.reason || `Setup ${runtime.setup || '-'} · Probe ${runtime.sage_probe || sage.version || '-'}`;

  const gpu = runtime.gpu || {};
  const gpuText = [
    gpu.name,
    gpu.vram_gb ? gpu.vram_gb + ' GB' : null,
    gpu.compute_capability ? 'sm_' + String(gpu.compute_capability).replace('.', '') : null
  ].filter(Boolean).join(' · ');

  let gpuBadge = $('#gpu-status');
  if (!gpuBadge) {
    gpuBadge = document.createElement('span');
    gpuBadge.id = 'gpu-status';
    badge.before(gpuBadge);
  }
  gpuBadge.textContent = `GPU · ${gpuText || 'กำลังตรวจสอบ'}`;
  gpuBadge.title = `Driver ${gpu.driver || '-'} · Compute ${gpu.compute_capability || '-'}`;

  const kj = $('#attention-mode option[value="kj_memory"]');
  kj.disabled = runtime.kj_sage_available !== true;
  if (kj.disabled && $('#attention-mode').value === 'kj_memory') {
    $('#attention-mode').value = 'global_sage';
  }
}

function notice(text) { $('#notice').textContent = text; }
function updateButton() { $('#generate').disabled = !ready || submitting; }

function renderMedia(kind) {
  $('#' + kind + '-count').textContent = `${media[kind].length} / ${limits[kind]}`;
  $('#' + kind + '-files').replaceChildren(
    ...media[kind].map((item, index) => {
      const row = document.createElement('div');
      row.className = 'file ' + kind;
      if (kind === 'image') {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = 'ภาพ ' + (index + 1);
        row.append(img);
      }
      const name = document.createElement('span');
      name.textContent = item.file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'ลบ ' + item.file.name);
      remove.onclick = () => {
        URL.revokeObjectURL(item.url);
        media[kind].splice(index, 1);
        renderMedia(kind);
      };
      row.append(name, remove);
      return row;
    })
  );
  renderTags();
}

function renderTags() {
  const tags = media.image.map((_, i) => `<Picture ${i + 1}>`);
  let audioIndex = 1;
  if ($('#video-enabled').checked && media.video.length) {
    tags.push('<Video 1>');
    if ($('#video-audio').checked) tags.push(`<Audio ${audioIndex++}>`);
  }
  if ($('#audio-enabled').checked) {
    media.audio.forEach(() => tags.push(`<Audio ${audioIndex++}>`));
  }
  $('#tags').replaceChildren(
    ...tags.map(tag => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tag;
      b.onclick = () => {
        $('#prompt').value += ' ' + tag;
        $('#prompt').focus();
      };
      return b;
    })
  );
}

function addFilesToKind(kind, fileList) {
  if (!fileList || !fileList.length) return;
  if ((kind === 'video' || kind === 'audio') && !$('#' + kind + '-enabled').checked) {
    $('#' + kind + '-enabled').checked = true;
    $('#' + kind + '-body').hidden = false;
  }
  let added = 0;
  for (const file of fileList) {
    if (media[kind].length >= limits[kind]) {
      notice(`เพิ่มได้สูงสุด ${limits[kind]} ไฟล์ในหมวดนี้`);
      break;
    }
    if (!extensions[kind].test(file.name) || file.size > 512 * 1024 * 1024) {
      notice(`ไฟล์ "${file.name}" ชนิดไม่รองรับหรือขนาดเกิน 512 MB`);
      continue;
    }
    media[kind].push({ file, url: URL.createObjectURL(file) });
    added++;
  }
  if (added > 0) {
    renderMedia(kind);
    notice(`เพิ่มไฟล์อ้างอิง ${added} ไฟล์เรียบร้อย`);
  }
}

for (const kind of Object.keys(media)) {
  const input = $('#' + kind + '-input');
  input.onchange = event => {
    addFilesToKind(kind, event.target.files);
    event.target.value = '';
  };

  const dropzone = $('#' + kind + '-dropzone');
  const section = $('#' + kind + '-ref-section');
  for (const target of [dropzone, section].filter(Boolean)) {
    target.addEventListener('dragenter', event => {
      event.preventDefault();
      event.stopPropagation();
      dropzone?.classList.add('is-dragover');
      section?.classList.add('is-dragover');
    });
    target.addEventListener('dragover', event => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      dropzone?.classList.add('is-dragover');
      section?.classList.add('is-dragover');
    });
    target.addEventListener('dragleave', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!target.contains(event.relatedTarget)) {
        dropzone?.classList.remove('is-dragover');
        section?.classList.remove('is-dragover');
      }
    });
    target.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      dropzone?.classList.remove('is-dragover');
      section?.classList.remove('is-dragover');
      const files = event.dataTransfer?.files;
      if (files && files.length) {
        addFilesToKind(kind, files);
      }
    });
  }
}

// Prevent accidental file drops outside dropzones from navigating the browser tab
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (files && files.length) {
    // Route by file extension automatically if dropped anywhere on the page
    const imgs = [...files].filter(f => extensions.image.test(f.name));
    const vids = [...files].filter(f => extensions.video.test(f.name));
    const auds = [...files].filter(f => extensions.audio.test(f.name));
    if (imgs.length) addFilesToKind('image', imgs);
    if (vids.length) addFilesToKind('video', vids);
    if (auds.length) addFilesToKind('audio', auds);
  }
});

for (const kind of ['video', 'audio']) {
  $('#' + kind + '-enabled').onchange = () => {
    $('#' + kind + '-body').hidden = !$('#' + kind + '-enabled').checked;
    renderTags();
  };
}
$('#video-audio').onchange = renderTags;

function updateAttentionHelp() {
  $('#attention-help').textContent = $('#attention-mode').value === 'kj_memory'
    ? 'ลด peak VRAM แต่อาจช้ากว่า เหมาะเมื่อ Global Sage มีปัญหาหน่วยความจำ'
    : 'ใช้ Global Sage แบบเดียวกับ RunPod เหมาะกับ RTX 5090';
}
$('#attention-mode').onchange = updateAttentionHelp;
updateAttentionHelp();

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}
function validSeed() {
  const seed = Number($('#seed').value);
  return Number.isInteger(seed) && seed >= 0 && seed <= 4294967295;
}
function updateSeedControls() {
  const locked = $('#seed-lock').checked;
  $('#seed').disabled = !locked;
  $('#seed-randomize').disabled = !locked;
  $('#seed-status').textContent = locked ? 'ล็อกอยู่ · งานถัดไปจะใช้ Seed นี้' : 'Auto · ระบบจะสุ่ม Seed ใหม่ทุกครั้ง';
}
function setLockedSeed(seed) {
  $('#seed').value = String(seed);
  $('#seed-lock').checked = true;
  updateSeedControls();
  $('#advanced').open = true;
  $('#seed').focus();
}
$('#seed').value = String(randomSeed());
$('#seed-lock').onchange = () => {
  if ($('#seed-lock').checked && !validSeed()) $('#seed').value = String(randomSeed());
  updateSeedControls();
};
$('#seed-randomize').onclick = () => {
  $('#seed').value = String(randomSeed());
  $('#seed').focus();
};
$('#reuse-latest-seed').onclick = () => lastSeed !== null && setLockedSeed(lastSeed);
updateSeedControls();

function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function updateSliderProgress(slider) {
  if (!slider) return;
  const min = Number(slider.min) || 0;
  const max = Number(slider.max) || 100;
  const val = Number(slider.value) || 0;
  const percent = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
  slider.style.setProperty('--fill-percent', `${percent}%`);
}

function updateDuration() {
  const slider = $('#duration');
  if (!slider) return;
  const seconds = Number(slider.value);
  const valEl = $('#duration-value');
  if (valEl) valEl.textContent = `${seconds} วินาที`;
  slider.setAttribute('aria-valuetext', `${seconds} วินาที`);
  updateSliderProgress(slider);
  const tc = $('#player-timecode');
  if (tc && !$('#preview video')) {
    tc.textContent = `00:00 / ${formatClock(seconds)}`;
  }
}
const durationInput = $('#duration');
if (durationInput) {
  durationInput.oninput = updateDuration;
  updateDuration();
}

const durationResetBtn = $('#duration-reset');
if (durationResetBtn) {
  durationResetBtn.onclick = () => {
    const slider = $('#duration');
    if (slider) {
      slider.value = '5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
}

function updateLoraStrength() {
  const input = $('#lora-strength');
  const badge = $('#lora-strength-value');
  if (!input || !badge) return;
  const val = Number(input.value);
  const text = val.toFixed(2);
  let label = 'สมดุลผิวจริง (แนะนำ)';
  if (val < 0.75) label = 'นุ่มนวลพิเศษ';
  else if (val > 0.90) label = 'คมจัด (ระวังผิวพลาสติก)';
  badge.textContent = `${text} · ${label}`;
  updateSliderProgress(input);
}
const loraInput = $('#lora-strength');
if (loraInput) {
  loraInput.oninput = updateLoraStrength;
  updateLoraStrength();
}

const loraResetBtn = $('#lora-reset');
if (loraResetBtn) {
  loraResetBtn.onclick = () => {
    const slider = $('#lora-strength');
    if (slider) {
      slider.value = '0.85';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
}

function setTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  $('#theme').setAttribute('aria-pressed', String(dark));
  $('#theme').setAttribute('title', dark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด');
  try { localStorage.setItem('tony-theme', dark ? 'dark' : 'light'); } catch {}
}
let savedTheme = 'dark';
try { savedTheme = localStorage.getItem('tony-theme') || localStorage.getItem('kendo-theme') || 'dark'; } catch {}
setTheme(savedTheme === 'dark');
$('#theme').onclick = () => setTheme(!document.documentElement.classList.contains('dark'));

function applySystemStatusPayload(s) {
  ready = Boolean(s.models_ready && s.comfy_ready);
  updateButton();
  const statusEl = $('#status');
  statusEl.textContent = ready ? 'READY' : s.download_error ? 'DOWNLOAD ERROR' : 'PREPARING';
  statusEl.className = ready ? 'is-ready' : s.download_error ? 'is-error' : 'is-preparing';
  $('#progress').hidden = ready;
  $('#progress').value = s.progress || 0;
  if (s.comfy_url) {
    document.querySelectorAll('.comfy-link').forEach(link => { link.href = s.comfy_url; });
  }
  if (!submitting && !jobs.size && !genState.active) {
    notice(
      s.download_error
        ? 'ดาวน์โหลดสะดุด กรุณา Restart Pod เพื่อดาวน์โหลดต่อ'
        : !s.models_ready
          ? `กำลังดาวน์โหลดโมเดล ${s.progress}%`
          : !s.comfy_ready
            ? 'กำลังเริ่ม ComfyUI…'
            : 'ระบบพร้อมสร้างวิดีโอ'
    );
  }
  renderRuntime(s.runtime);
  renderDisk(s.disk);
  renderActiveModels(s.active_models);
  renderClaude(s);
  if (s.generation) renderGenerationCard(s.generation);
}

async function systemStatusFallback() {
  try {
    const s = await TonyApi.fetchStatus();
    applySystemStatusPayload(s);
  } catch {
    ready = false;
    updateButton();
    $('#status').textContent = 'OFFLINE';
  }
}

function renderClaude(s) {
  const card = $('#claude');
  if (!card) return;
  card.hidden = false;
  const mcpUrl = s.mcp_url || `${window.location.origin.replace(/:3000\b/, ':3001')}/mcp/tony-studio`;
  $('#claude-url').value = mcpUrl;
  $('#claude-code-cmd').textContent = 'claude mcp add --transport http tony ' + mcpUrl;
  if ($('#codex-code-cmd')) {
    $('#codex-code-cmd').textContent = 'codex mcp add tony --url ' + mcpUrl;
  }
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(mcpUrl);
  $('#claude-state').textContent = (s.mcp_ready !== false)
    ? (local ? 'ออนไลน์บนเครื่องนี้ · พร้อมเชื่อมต่อ AI Agent' : 'ออนไลน์ · พร้อมเชื่อมต่อ Claude / Codex / Cursor / Antigravity')
    : 'กำลังเริ่มบริการ…';
  $('#claude-remote-help').innerHTML = local
    ? '<b>Claude Desktop/Claude.ai</b>: Local URL ใช้จากภายนอกไม่ได้ ต้องสร้าง HTTPS tunnel ก่อน'
    : '<b>Claude Desktop/Claude.ai</b>: Settings → Connectors → Add custom connector → วาง URL → Add';
  $('#claude-hint').textContent = local
    ? 'URL นี้ใช้ได้เฉพาะ MCP client บนเครื่องนี้ · หากต้องการเชื่อมจากภายนอก ให้สร้าง Public HTTPS tunnel'
    : 'เก็บ URL นี้เป็นความลับ เพราะผู้ที่มี URL สามารถสั่งงาน Tony ได้';
}
$('#claude-toggle').onclick = () => {
  const open = $('#claude-steps').hidden;
  $('#claude-steps').hidden = !open;
  $('#claude-toggle').setAttribute('aria-expanded', String(open));
};
$('#claude-copy').onclick = async () => {
  const url = $('#claude-url').value;
  try { await navigator.clipboard.writeText(url); } catch { $('#claude-url').select(); document.execCommand('copy'); }
  $('#claude-copy').textContent = 'คัดลอกแล้ว ✓';
  setTimeout(() => { $('#claude-copy').textContent = 'คัดลอก URL'; }, 2000);
};

/* Real-time Console Log SSE Stream */
function updateConsoleView() {
  const view = $('#comfy-console');
  const follow = view.scrollHeight - view.scrollTop - view.clientHeight < 60;
  const gpu = logGpuText ? `\n\n===== GPU PERFORMANCE (ล่าสุด) =====\n${logGpuText}` : '';
  view.textContent = (logRawText || 'ComfyUI เริ่มทำงานแล้ว · กำลังรอข้อความ Log…') + gpu;
  if (follow) view.scrollTop = view.scrollHeight;
}

function startLogStream() {
  if (logStream) return;
  $('#console-state').textContent = 'กำลังเชื่อมต่อ Real-time Log…';
  logStream = TonyApi.connectLogStream({
    getOffset: () => logOffset,
    onOpen: () => { $('#console-state').textContent = 'LIVE · อัปเดตแบบ Real-time'; },
    onSnapshot: data => {
      logOffset = data.offset || 0;
      logRawText = data.text || '';
      if (data.gpu_text !== undefined) logGpuText = data.gpu_text || '';
      $('#console-state').textContent = data.available ? 'LIVE · อัปเดตแบบ Real-time' : 'กำลังรอ ComfyUI เริ่มทำงาน…';
      updateConsoleView();
    },
    onAppend: data => {
      logOffset = data.offset || logOffset;
      logRawText += data.text || '';
      if (logRawText.length > 220 * 1024) {
        logRawText = '… แสดงเฉพาะ Log ล่าสุด …\n' + logRawText.slice(-192 * 1024);
      }
      $('#console-state').textContent = 'LIVE · อัปเดตแบบ Real-time';
      updateConsoleView();
    },
    onGpu: data => {
      logGpuText = data.gpu_text || '';
      updateConsoleView();
    },
    onError: () => {
      $('#console-state').textContent = 'กำลังเชื่อมต่อ Log ใหม่…';
    }
  });
}

function stopLogStream() {
  if (logStream) {
    logStream.close();
    logStream = null;
  }
  $('#console-state').textContent = 'เมนู Log · คลิกเพื่อเปิด';
}

$('#console-panel').ontoggle = () => {
  if ($('#console-panel').open) startLogStream();
  else stopLogStream();
};

/* History & Video Deletion */
const HISTORY_KEY = 'tony-h3-v3-history';

function isStudioWorkflow(workflow) {
  if (!workflow) return false;
  const prefix = String(workflow.save?.inputs?.filename_prefix || '');
  return Boolean(workflow.reference || prefix.startsWith('video/Tony_H3') || prefix.startsWith('video/Kendo_H3'));
}

function findVideo(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.filename === 'string' && /\.(mp4|webm|mov|mkv)$/i.test(value.filename)) return value;
  for (const v of Object.values(value)) {
    const match = findVideo(v);
    if (match) return match;
  }
  return null;
}

function videoUrl(file) {
  return '/api/comfy/view?' + new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || '',
    type: file.type || 'output'
  });
}

function parseVideoUrlParams(url) {
  try {
    const u = new URL(url, window.location.origin);
    return {
      filename: u.searchParams.get('filename') || '',
      subfolder: u.searchParams.get('subfolder') || '',
      type: u.searchParams.get('type') || 'output'
    };
  } catch {
    return { filename: '', subfolder: '', type: 'output' };
  }
}

function showVideo(url) {
  $('#welcome').hidden = true;
  $('#preview video')?.remove();
  const v = document.createElement('video');
  v.src = url;
  v.controls = true;
  v.playsInline = true;
  const syncTime = () => {
    const tc = $('#player-timecode');
    if (tc) {
      tc.textContent = `${formatClock(v.currentTime)} / ${formatClock(v.duration || Number($('#duration').value))}`;
    }
  };
  v.onloadedmetadata = syncTime;
  v.ontimeupdate = syncTime;
  $('#preview').append(v);
  $('#download').href = url;
  $('#download').hidden = false;
}

if ($('#player-fullscreen')) {
  $('#player-fullscreen').onclick = () => {
    const target = $('#preview video') || $('#preview');
    if (target?.requestFullscreen) target.requestFullscreen().catch(() => {});
  };
}

function clearPreviewIfMatching(url) {
  const currentVideo = $('#preview video');
  if (currentVideo && (currentVideo.getAttribute('src') === url || currentVideo.src.endsWith(url))) {
    currentVideo.remove();
    $('#welcome').hidden = false;
    $('#download').hidden = true;
  }
}

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY) || localStorage.getItem('kendo-h3-v3-history') || '[]';
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeHistory(items) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {}
}

function removeDeletedFromLocalHistory(filename, jobId) {
  const current = readHistory();
  const filtered = current.filter(item => {
    const params = parseVideoUrlParams(item.url);
    if (filename && params.filename === filename) {
      clearPreviewIfMatching(item.url);
      return false;
    }
    if (jobId && item.id === jobId) {
      clearPreviewIfMatching(item.url);
      return false;
    }
    return true;
  });
  if (filtered.length !== current.length) {
    writeHistory(filtered);
    renderHistory();
  }
}

function compareHistoryItems(a, b) {
  const aSeq = Number(a.sequence);
  const bSeq = Number(b.sequence);
  const aHas = a.sequence !== null && a.sequence !== undefined && Number.isFinite(aSeq);
  const bHas = b.sequence !== null && b.sequence !== undefined && Number.isFinite(bSeq);
  if (aHas && bHas && aSeq !== bSeq) return bSeq - aSeq;
  if (aHas !== bHas) return aHas ? -1 : 1;
  return String(b.id || b.url).localeCompare(String(a.id || a.url));
}

function bindDeleteButton(btn, item) {
  let confirmTimer = null;
  const trashSvg = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  btn.onclick = async () => {
    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming');
      btn.innerHTML = 'ยืนยันลบ?';
      confirmTimer = setTimeout(() => {
        btn.classList.remove('confirming');
        btn.innerHTML = `${trashSvg} ลบ`;
      }, 4000);
      return;
    }
    clearTimeout(confirmTimer);
    btn.disabled = true;
    btn.textContent = 'กำลังลบ…';
    const params = parseVideoUrlParams(item.url);
    try {
      const res = await TonyApi.deleteVideo({
        filename: item.filename || params.filename,
        subfolder: item.subfolder ?? params.subfolder,
        type: item.type || params.type,
        jobId: item.id || null
      });
      removeDeletedFromLocalHistory(params.filename, item.id);
      if (res.disk) renderDisk(res.disk);
      notice(`ลบวิดีโอ "${params.filename}" เรียบร้อยแล้ว`);
    } catch (e) {
      btn.disabled = false;
      btn.classList.remove('confirming');
      btn.innerHTML = `${trashSvg} ลบ`;
      notice(e.message || 'ลบไฟล์ไม่สำเร็จ');
    }
  };
}

function createHistoryCard(item) {
  const article = document.createElement('article');
  const v = document.createElement('video');
  const actions = document.createElement('div');
  const a = document.createElement('a');
  const del = document.createElement('button');

  article.dataset.url = item.url;
  v.src = item.url;
  v.controls = true;
  v.playsInline = true;
  v.preload = 'metadata';

  actions.className = 'history-actions';
  a.href = item.url;
  a.download = '';
  a.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ดาวน์โหลด';

  del.type = 'button';
  del.className = 'delete-btn';
  del.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> ลบ';

  actions.append(a, del);
  article.append(v, actions);
  updateHistoryCard(article, item);
  return article;
}

function updateHistoryCard(article, item) {
  const actions = article.querySelector('.history-actions');
  let use = actions.querySelector('button.seed-reuse-btn');
  if (Number.isInteger(item.seed)) {
    if (!use) {
      use = document.createElement('button');
      use.type = 'button';
      use.className = 'seed-reuse-btn';
      actions.insertBefore(use, actions.querySelector('.delete-btn'));
    }
    use.textContent = 'Seed ' + item.seed + ' · ใช้ต่อ';
    use.onclick = () => setLockedSeed(item.seed);
  } else {
    use?.remove();
  }
  const del = actions.querySelector('.delete-btn');
  if (del) bindDeleteButton(del, item);
}

function renderHistory() {
  const history = readHistory();
  const container = $('#history');
  const existing = new Map([...container.children].map(article => [article.dataset.url, article]));
  const wanted = new Set();
  let cursor = container.firstElementChild;
  for (const item of history) {
    let article = existing.get(item.url);
    if (!article) article = createHistoryCard(item);
    else updateHistoryCard(article, item);
    wanted.add(item.url);
    if (article === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(article, cursor);
  }
  for (const article of [...container.children]) {
    if (!wanted.has(article.dataset.url)) article.remove();
  }
}

async function syncServerHistory() {
  let history;
  try { history = await TonyApi.comfy('/history?max_items=40'); } catch { return; }
  const local = readHistory();
  const byUrl = new Map(local.map(item => [item.url, item]));
  const server = [];
  for (const [id, entry] of Object.entries(history)) {
    const workflow = Array.isArray(entry.prompt) ? entry.prompt[2] : null;
    if (!isStudioWorkflow(workflow)) continue;
    const file = findVideo(entry.outputs);
    if (!file) continue;
    const url = videoUrl(file);
    const sequence = Number(entry.prompt?.[0]);
    server.push({
      ...byUrl.get(url),
      url,
      filename: file.filename,
      subfolder: file.subfolder || '',
      type: file.type || 'output',
      seed: workflow.noise?.inputs?.noise_seed,
      id,
      sequence: Number.isFinite(sequence) ? sequence : null
    });
  }
  server.sort(compareHistoryItems);
  const merged = server.slice(0, 40);
  if (JSON.stringify(local) === JSON.stringify(merged)) return;
  writeHistory(merged);
  renderHistory();
}

function uploadName(name) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48) || 'ref';
  return base + '-' + crypto.randomUUID().slice(0, 6) + (dot > 0 ? name.slice(dot).toLowerCase() : '');
}

async function upload(file) {
  const form = new FormData();
  form.append('image', file, uploadName(file.name));
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const r = await TonyApi.comfy('/upload/image', { method: 'POST', body: form });
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

async function finalizeJobResult(id, fallbackSeed = null) {
  try {
    const history = await TonyApi.comfy('/history/' + encodeURIComponent(id));
    const entry = history[id];
    if (!entry) return false;
    if (entry.status?.status_str === 'error') {
      throw new Error('ComfyUI ประมวลผลไม่สำเร็จ ตรวจ Logs ใน Comfy Console');
    }
    const file = findVideo(entry.outputs);
    if (!file) return false;
    const url = videoUrl(file);
    const workflow = Array.isArray(entry.prompt) ? entry.prompt[2] : null;
    const seed = fallbackSeed ?? workflow?.noise?.inputs?.noise_seed ?? lastSeed;
    const sequence = Number(entry.prompt?.[0]);
    const item = {
      url,
      filename: file.filename,
      subfolder: file.subfolder || '',
      type: file.type || 'output',
      seed,
      id,
      sequence: Number.isFinite(sequence) ? sequence : null
    };
    const current = readHistory().filter(old => old.url !== url);
    showVideo(url);
    writeHistory([item, ...current].sort(compareHistoryItems).slice(0, 40));
    renderHistory();
    jobs.delete(id);
    genState.active = false;
    $('#generation-card').hidden = true;
    $('#activity').textContent = jobs.size ? `${jobs.size} งานในคิว` : 'สร้างวิดีโอสำเร็จ ✓';
    notice('สร้างวิดีโอเสร็จสมบูรณ์ · Seed ' + (seed ?? '-'));
    return true;
  } catch (e) {
    notice(e.message);
    return false;
  }
}

async function monitor(id, seed) {
  try {
    const deadline = Date.now() + 6 * 60 * 60 * 1000;
    while (Date.now() < deadline && jobs.has(id)) {
      await new Promise(r => setTimeout(r, 4000));
      if (!jobs.has(id)) return;
      const done = await finalizeJobResult(id, seed);
      if (done) return;
    }
  } catch (e) {
    notice(e.message);
  } finally {
    jobs.delete(id);
    if (!jobs.size) {
      genState.active = false;
      $('#generation-card').hidden = true;
      $('#activity').textContent = 'พร้อมรับงานถัดไป';
    }
  }
}

$('#cancel-job').onclick = async () => {
  const btn = $('#cancel-job');
  btn.disabled = true;
  try {
    await TonyApi.interruptComfy();
    jobs.clear();
    genState.active = false;
    $('#generation-card').hidden = true;
    notice('ส่งคำสั่งยกเลิกงานไปยัง ComfyUI แล้ว');
  } catch (e) {
    notice(e.message || 'ยกเลิกงานไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
};

async function generate() {
  if (!ready || submitting) return;
  const prompt = $('#prompt').value.trim();
  if (!prompt) return notice('กรุณากรอกคำอธิบายวิดีโอ');
  if ($('#seed-lock').checked && !validSeed()) return notice('Seed ต้องเป็นเลขจำนวนเต็ม 0–4,294,967,295');
  const seed = $('#seed-lock').checked ? Number($('#seed').value) : randomSeed();
  lastSeed = seed;
  $('#seed').value = String(seed);
  $('#reuse-latest-seed').hidden = false;
  $('#reuse-latest-seed').textContent = 'ใช้ Seed ล่าสุดต่อ · ' + seed;

  const selected = {
    images: media.image.map(x => x.file),
    videos: $('#video-enabled').checked ? media.video.map(x => x.file) : [],
    audios: $('#audio-enabled').checked ? media.audio.map(x => x.file) : []
  };
  const settings = {
    prompt,
    model: $('#model-select').value,
    ratio: $('#ratio').value,
    megapixels: Number($('#quality').value),
    duration: Number($('#duration').value),
    steps: Number($('#steps').value),
    loraStrength: $('#lora-strength') ? Number($('#lora-strength').value) : 0.85,
    sampler: $('#sampler') ? $('#sampler').value : 'res_multistep',
    seed,
    videoAudio: $('#video-audio').checked,
    attentionMode: $('#attention-mode').value
  };
  try {
    TonyWorkflow.buildWorkflow({ ...settings, images: [], videos: [], audios: [] });
  } catch (e) {
    return notice(e.message);
  }

  submitting = true;
  updateButton();
  genState = {
    active: true,
    startedAtMs: Date.now(),
    etaSeconds: null,
    etaUpdatedAtMs: null,
    phaseLabel: 'กำลังอัปโหลดไฟล์อ้างอิง…',
    percent: 1,
    step: 0,
    maxSteps: settings.steps
  };
  renderGenerationCard({
    phase: 'loading',
    phase_label: 'กำลังอัปโหลดไฟล์อ้างอิง…',
    percent: 1,
    step: 0,
    max_steps: settings.steps
  });
  notice('กำลังอัปโหลดไฟล์…');

  try {
    const names = {};
    for (const [kind, files] of Object.entries(selected)) {
      names[kind] = [];
      for (const file of files) names[kind].push(await upload(file));
    }
    const workflow = TonyWorkflow.buildWorkflow({ ...settings, ...names });
    const result = await TonyApi.comfy('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'tony-studio-bridge' })
    });
    if (!result.prompt_id) throw new Error('ไม่พบหมายเลขงาน');
    jobs.set(result.prompt_id, true);
    $('#activity').textContent = `${jobs.size} งานในคิว`;
    notice('ส่งเข้าคิวแล้ว · Seed ' + seed);
    void monitor(result.prompt_id, seed);
  } catch (e) {
    genState.active = false;
    $('#generation-card').hidden = true;
    notice(String(e.message));
  } finally {
    submitting = false;
    updateButton();
  }
}

// =============================================================================
// Tailwind Floating Dropdown (Matching Image 2: modern popup menu)
// =============================================================================
const DROPDOWN_ICONS = {
  // Ratio
  '16:9': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="12" x="2" y="6" rx="2"/></svg>',
  '9:16': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="12" height="20" x="6" y="2" rx="2"/></svg>',
  '1:1': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
  // Quality
  '0.4': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  '0.7': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>',
  '1': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  '1.2': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  '1.5': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="6 3 18 3 22 9 12 22 2 9"/><line x1="12" y1="22" x2="12" y2="9"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="6" y1="3" x2="10" y2="9"/><line x1="18" y1="3" x2="14" y2="9"/></svg>',
  '2': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="20" x="2" y="2" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>',
  // Models
  'original': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
  'singularity': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>',
  'original-bf16': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
  // Samplers
  'res_multistep': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
  'euler': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
  // Attention
  'global_sage': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  'kj_memory': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
};

const DEFAULT_DROPDOWN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>';
const DROPDOWN_CHECK_SVG = '<svg class="tw-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
const DROPDOWN_CHEVRON_SVG = '<svg class="tw-dropdown-chevron" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>';

function setupTailwindDropdown(select) {
  if (!select || select.dataset.twDropdownInit) return;
  select.dataset.twDropdownInit = 'true';
  select.classList.add('sr-only');

  const wrapper = document.createElement('div');
  wrapper.className = 'tw-dropdown';
  wrapper.dataset.for = select.id;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tw-dropdown-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const triggerLeft = document.createElement('span');
  triggerLeft.className = 'tw-dropdown-trigger-left';
  const triggerIcon = document.createElement('span');
  triggerIcon.className = 'tw-dropdown-icon';
  const triggerLabel = document.createElement('span');
  triggerLabel.className = 'tw-dropdown-label';
  triggerLeft.append(triggerIcon, triggerLabel);

  trigger.append(triggerLeft);
  trigger.insertAdjacentHTML('beforeend', DROPDOWN_CHEVRON_SVG);

  const menu = document.createElement('div');
  menu.className = 'tw-dropdown-menu';
  menu.setAttribute('role', 'listbox');

  wrapper.append(trigger, menu);
  select.after(wrapper);

  function syncFromSelect() {
    menu.replaceChildren();
    const currentVal = select.value;
    let selectedOption = select.selectedOptions[0] || select.options[0];

    for (const opt of select.options) {
      if (opt.hidden) continue;
      const item = document.createElement('div');
      item.className = 'tw-dropdown-item';
      item.setAttribute('role', 'option');
      item.dataset.value = opt.value;
      if (opt.disabled) item.classList.add('disabled');
      if (opt.value === currentVal) {
        item.classList.add('active');
        item.setAttribute('aria-selected', 'true');
        selectedOption = opt;
      }

      const itemLeft = document.createElement('div');
      itemLeft.className = 'tw-dropdown-item-left';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'tw-dropdown-item-icon';
      iconSpan.innerHTML = DROPDOWN_ICONS[opt.value] || DEFAULT_DROPDOWN_ICON;

      const textWrap = document.createElement('div');
      textWrap.className = 'tw-dropdown-item-text';

      const rawText = opt.textContent.trim();
      const parts = rawText.split('·').map(p => p.trim());
      const titleSpan = document.createElement('span');
      titleSpan.className = 'tw-dropdown-item-title';
      titleSpan.textContent = parts[0] || rawText;
      textWrap.append(titleSpan);

      if (parts.length > 1) {
        const subSpan = document.createElement('span');
        subSpan.className = 'tw-dropdown-item-sub';
        subSpan.textContent = parts.slice(1).join(' · ');
        textWrap.append(subSpan);
      }

      itemLeft.append(iconSpan, textWrap);
      item.append(itemLeft);
      item.insertAdjacentHTML('beforeend', DROPDOWN_CHECK_SVG);

      item.onclick = (e) => {
        e.stopPropagation();
        if (opt.disabled) return;
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeMenu();
      };

      menu.append(item);
    }

    if (selectedOption) {
      triggerLabel.textContent = selectedOption.textContent.trim();
      triggerIcon.innerHTML = DROPDOWN_ICONS[selectedOption.value] || DEFAULT_DROPDOWN_ICON;
    }
    trigger.disabled = select.disabled;
    if (select.disabled) wrapper.classList.add('disabled');
    else wrapper.classList.remove('disabled');
  }

  function openMenu() {
    if (select.disabled) return;
    document.querySelectorAll('.tw-dropdown.open').forEach(d => {
      if (d !== wrapper) d.classList.remove('open');
    });
    wrapper.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    wrapper.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.onclick = (e) => {
    e.stopPropagation();
    if (wrapper.classList.contains('open')) closeMenu();
    else openMenu();
  };

  select.addEventListener('change', syncFromSelect);

  const observer = new MutationObserver(() => syncFromSelect());
  observer.observe(select, { childList: true, attributes: true, subtree: true });

  syncFromSelect();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.tw-dropdown')) {
    document.querySelectorAll('.tw-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.tw-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

// Initialize all setting dropdowns
['#model-select', '#ratio', '#quality', '#sampler', '#attention-mode'].forEach(id => {
  const el = $(id);
  if (el) setupTailwindDropdown(el);
});

$('#generate').onclick = generate;
renderRuntime();
renderHistory();
void systemStatusFallback();
void syncServerHistory();

// Connect Real-time SSE Event Stream (with lightweight fallback sync)
TonyApi.connectEvents({
  onStatus: data => applySystemStatusPayload(data),
  onGeneration: data => renderGenerationCard(data),
  onError: () => { void systemStatusFallback(); }
});

setInterval(syncServerHistory, 20000);

