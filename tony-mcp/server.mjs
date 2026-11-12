// Tony H3 MCP server: lets Claude Desktop / Claude Code drive MiniMax H3
// generation through the same ComfyUI graph the Page uses.
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { registerKieTools } from './kie-tools.mjs';
import { registerImageTools } from './image-tools.mjs';

const require = createRequire(import.meta.url);
const VERSION = process.env.TONY_IMAGE_VERSION || process.env.KENDO_IMAGE_VERSION || '3.0.0-tony.1';
const env = (tonyKey, legacyKey, fallback) =>
  (process.env[tonyKey] ?? '').trim() ||
  (legacyKey ? (process.env[legacyKey] ?? '').trim() : '') ||
  fallback;

function resolveWorkflowFile() {
  const candidates = [
    process.env.TONY_WORKFLOW_FILE,
    '/opt/tony/views/assets/js/models/workflow-v3-beta.js',
    process.env.KENDO_WORKFLOW_FILE
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) || '/opt/tony/views/assets/js/models/workflow-v3-beta.js';
}

const CONFIG = {
  host: env('TONY_MCP_HOST', 'KENDO_MCP_HOST', '0.0.0.0'),
  port: Number(env('TONY_MCP_PORT', 'KENDO_MCP_PORT', '3001')),
  code: env('TONY_MCP_CODE', 'KENDO_MCP_CODE', ''),
  comfy: `http://${env('TONY_COMFY_HOST', 'KENDO_COMFY_HOST', '127.0.0.1')}:${env('TONY_COMFY_PORT', 'KENDO_COMFY_PORT', '8188')}`,
  page: `http://${env('TONY_PAGE_HOST_INTERNAL', 'KENDO_PAGE_HOST_INTERNAL', '127.0.0.1')}:${env('TONY_PAGE_PORT', 'KENDO_PAGE_PORT', '3000')}`,
  inputDir: env('TONY_INPUT_DIR', 'KENDO_INPUT_DIR', '/workspace/runpod-slim/ComfyUI/input'),
  workflowFile: resolveWorkflowFile(),
  publicPage: env('TONY_PUBLIC_PAGE_URL', 'KENDO_PUBLIC_PAGE_URL', process.env.RUNPOD_POD_ID ? `https://${process.env.RUNPOD_POD_ID.trim()}-${env('TONY_PAGE_PORT', 'KENDO_PAGE_PORT', '3000')}.proxy.runpod.net` : ''),
  maxUploadBytes: 512 * 1024 * 1024,
  enableImages: env('TONY_ENABLE_IMAGES', 'KENDO_ENABLE_IMAGES', '1') === '1',
  allowLoopback: env('TONY_MCP_ALLOW_LOOPBACK', 'KENDO_MCP_ALLOW_LOOPBACK', '0') === '1'
};
const { buildWorkflow } = require(CONFIG.workflowFile);

const KINDS = { image: ['png', 'jpg', 'jpeg', 'webp'], video: ['mp4', 'webm', 'mov'], audio: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] };
const MIME_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' };
const kindOf = name => Object.keys(KINDS).find(kind => KINDS[kind].includes(path.extname(name).slice(1).toLowerCase())) || null;
const SIZES = { '0.4': [864, 480], '0.7': [1152, 640], '1': [1376, 768], '1.2': [1504, 832], '1.5': [1632, 928], '2': [1920, 1088] };

class ToolError extends Error {}

async function comfy(route, options = {}) {
  let response;
  try {
    response = await fetch(CONFIG.comfy + route, { ...options, signal: AbortSignal.timeout(options.timeout ?? 30000) });
  } catch (error) {
    throw new ToolError('ComfyUI is not reachable yet: ' + error.message);
  }
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const detail = body.error?.message || body.error || JSON.stringify(body.node_errors || body);
    throw new ToolError(`ComfyUI ${response.status}: ${detail}`);
  }
  return body;
}

async function pageStatus() {
  try {
    const response = await fetch(CONFIG.page + '/api/tony/status', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } catch {
    return { models_ready: false, comfy_ready: false, progress: 0, download_error: null, page_unreachable: true };
  }
}

function videoUrl(file) {
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
  return `${CONFIG.publicPage}/api/comfy/view?${query}`;
}

function findVideo(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.filename === 'string' && /\.(mp4|webm|mov|mkv)$/i.test(value.filename)) return value;
  for (const item of Object.values(value)) { const match = findVideo(item); if (match) return match; }
  return null;
}

function summarizeHistoryEntry(id, entry) {
  const workflow = Array.isArray(entry.prompt) ? entry.prompt[2] : null;
  const reference = workflow?.reference?.inputs || {};
  const file = findVideo(entry.outputs);
  const status = entry.status?.status_str === 'error' ? 'error' : file ? 'done' : 'finished_without_video';
  const summary = {
    job_id: id,
    status,
    seed: workflow?.noise?.inputs?.noise_seed ?? null,
    width: reference.width ?? null,
    height: reference.height ?? null,
    duration_seconds: reference.length ? Math.round(reference.length / 24) : null,
    steps: workflow?.schedule?.inputs?.steps ?? null,
    reference_count: Object.keys(reference).filter(key => key.startsWith('ref_')).length
  };
  if (file) { summary.filename = file.filename; summary.video_url = videoUrl(file); }
  if (status === 'error') summary.error = (entry.status?.messages || []).filter(([type]) => type === 'execution_error').map(([, detail]) => detail?.exception_message || JSON.stringify(detail)).join('\n') || 'ComfyUI reported an execution error';
  return summary;
}

function isTonyJob(entry) {
  const workflow = Array.isArray(entry?.prompt) ? entry.prompt[2] : null;
  const prefix = String(workflow?.save?.inputs?.filename_prefix || '');
  return Boolean(workflow?.reference && (prefix.startsWith('video/Tony_H3') || prefix.startsWith('video/Kendo_H3')));
}

async function listReferences(kind = 'all') {
  let names;
  try { names = await fs.readdir(CONFIG.inputDir); } catch { return []; }
  const items = [];
  for (const name of names) {
    const fileKind = kindOf(name);
    if (!fileKind || (kind !== 'all' && fileKind !== kind)) continue;
    try {
      const stat = await fs.stat(path.join(CONFIG.inputDir, name));
      if (stat.isFile()) items.push({ name, kind: fileKind, size_bytes: stat.size, modified: stat.mtime.toISOString() });
    } catch {}
  }
  return items.sort((a, b) => b.modified.localeCompare(a.modified));
}

async function requireReference(name, kind) {
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.includes('..')) throw new ToolError(`Invalid reference name: ${name}`);
  if (kindOf(name) !== kind) throw new ToolError(`${name} is not a supported ${kind} file`);
  try { await fs.access(path.join(CONFIG.inputDir, name)); } catch { throw new ToolError(`Reference not found in the Pod: ${name}. Upload it first with tony_upload_from_url or the Page.`); }
  return name;
}

function blockedHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (CONFIG.allowLoopback && (host === 'localhost' || host.startsWith('127.'))) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function safeBase(value, fallback) {
  const base = (value || '').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 48);
  return base || fallback;
}

async function downloadReference(url, preferredName, index) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new ToolError(`Invalid URL: ${url}`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || blockedHost(parsed.hostname)) throw new ToolError(`URL not allowed: ${url}`);
  let response;
  try {
    response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(180000), headers: { 'User-Agent': 'tony-h3-mcp/' + VERSION } });
  } catch (error) {
    throw new ToolError(`Download failed for ${url}: ${error.message}`);
  }
  if (!response.ok) throw new ToolError(`Download failed for ${url}: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > CONFIG.maxUploadBytes) throw new ToolError(`File exceeds 512 MB: ${url}`);
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const urlExtension = path.extname(parsed.pathname).slice(1).toLowerCase();
  const extension = MIME_EXTENSIONS[mime] || (kindOf('x.' + urlExtension) ? urlExtension : null);
  if (!extension) throw new ToolError(`Unsupported file type for ${url} (content-type ${mime || 'unknown'})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > CONFIG.maxUploadBytes) throw new ToolError(`File exceeds 512 MB: ${url}`);
  if (!buffer.length) throw new ToolError(`Empty file: ${url}`);
  const base = safeBase(preferredName || path.basename(parsed.pathname, path.extname(parsed.pathname)), 'ref-' + (index + 1));
  const name = `${base}-${crypto.randomBytes(3).toString('hex')}.${extension}`;
  await fs.mkdir(CONFIG.inputDir, { recursive: true });
  await fs.writeFile(path.join(CONFIG.inputDir, name), buffer);
  return { url, name, kind: kindOf(name), size_bytes: buffer.length };
}

const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });
const failure = message => ({ content: [{ type: 'text', text: message }], isError: true });
const guard = handler => async (args, extra) => {
  try { return result(await handler(args ?? {}, extra)); } catch (error) {
    if (error instanceof ToolError) return failure(error.message);
    console.error('[TONY MCP] tool failure', error);
    return failure('Unexpected error: ' + error.message);
  }
};

const INSTRUCTIONS = `Tony Studio MiniMax H3 video generator running inside a RunPod Pod.
Typical flow: (1) tony_status until models_ready and comfy_ready are true. (2) Put reference files into the Pod with tony_upload_from_url (any public image/video/audio URL, e.g. results from an image generator) or read the files the user uploaded on the Page with tony_list_references. (3) tony_generate with the prompt; refer to references inside the prompt as <Picture 1>, <Picture 2> (order of the images array), <Video 1>, and <Audio 1..3> (video soundtrack first when video_audio is true, then standalone audios). (4) Poll tony_job_status every 15-30 seconds until status is done, then give the user the video_url. Generation usually takes a few minutes; never block on it.
KIE video flow: kie_status, then kie_seedance_generate (seedance-2 is regular 2.0; seedance-2-5 is 2.5). KIE image flow: kie_image_models, then kie_image_generate with a supported model ID; all image models use the same KIE key. Only set confirm_cost=true for a user-authorized paid request; poll kie_job_status. Do not automatically recreate a task after connection failures. All tools share this MCP URL.`;

function createServer({ enableImages = CONFIG.enableImages } = {}) {
  const instructions = INSTRUCTIONS + (enableImages ? '\nLocal Qwen image flow: tony_image_status, then tony_image_generate using GPU on this Pod; poll tony_image_job_status. Qwen uses no KIE credits.' : '');
  const server = new McpServer({ name: process.env.TONY_MCP_NAME || 'tony-h3', version: VERSION }, { instructions });
  registerKieTools(server);
  if (enableImages) registerImageTools(server);

  server.registerTool('tony_status', {
    title: 'Tony status',
    description: 'Readiness of the MiniMax H3 models and ComfyUI, model download progress, and the current generation queue.'
  }, guard(async () => {
    const status = await pageStatus();
    let queue = { running: 0, pending: 0 };
    try { const q = await comfy('/queue'); queue = { running: q.queue_running?.length ?? 0, pending: q.queue_pending?.length ?? 0 }; } catch {}
    return { version: VERSION, ready: Boolean(status.models_ready && status.comfy_ready), models_ready: Boolean(status.models_ready), comfy_ready: Boolean(status.comfy_ready), download_progress_percent: status.progress ?? 0, download_error: status.download_error ?? null, queue, page_url: CONFIG.publicPage || null };
  }));

  server.registerTool('tony_list_references', {
    title: 'List reference files',
    description: 'Lists image, video and audio reference files already stored in the Pod (uploaded through the Page or tony_upload_from_url), newest first.',
    inputSchema: { kind: z.enum(['all', 'image', 'video', 'audio']).default('all').describe('Filter by media kind'), limit: z.number().int().min(1).max(200).default(50) }
  }, guard(async ({ kind = 'all', limit = 50 }) => {
    const items = (await listReferences(kind)).slice(0, limit);
    return { count: items.length, references: items };
  }));

  server.registerTool('tony_upload_from_url', {
    title: 'Upload references from URLs',
    description: 'Downloads public image (png/jpg/webp), video (mp4/webm/mov) or audio (wav/mp3/flac/ogg/m4a) URLs into the Pod so they can be used as references. Returns the stored file names to pass to tony_generate. Max 512 MB per file.',
    inputSchema: { urls: z.array(z.string().url()).min(1).max(13).describe('Public http(s) URLs to download'), names: z.array(z.string().max(48)).optional().describe('Optional readable base names, same order as urls (e.g. "hero-front", "cafe-location")') }
  }, guard(async ({ urls, names = [] }) => {
    const uploaded = [], failed = [];
    for (const [index, url] of urls.entries()) {
      try { uploaded.push(await downloadReference(url, names[index], index)); } catch (error) { if (!(error instanceof ToolError)) throw error; failed.push({ url, error: error.message }); }
    }
    if (!uploaded.length) throw new ToolError('No file could be downloaded:\n' + failed.map(f => `${f.url}: ${f.error}`).join('\n'));
    return { uploaded, failed, hint: 'Pass uploaded[].name to tony_generate (images / video / audios).' };
  }));

  server.registerTool('tony_generate', {
    title: 'Generate video',
    description: 'Queues a MiniMax H3 Ref2VA video from a prompt plus optional references stored in the Pod. Returns a job_id immediately; poll tony_job_status for the result. Reference tags: <Picture N> for images (order of the images array), <Video 1> for the video, <Audio N> for audio (video soundtrack first when video_audio is true).',
    inputSchema: {
      prompt: z.string().min(1).max(20000).describe('Scene, motion, camera and sound description. Use <Picture 1> style tags to bind references.'),
      images: z.array(z.string()).max(9).default([]).describe('Up to 9 image reference file names from tony_list_references / tony_upload_from_url'),
      video: z.string().optional().describe('Optional video reference file name (first output-duration seconds are used at 24 fps)'),
      video_audio: z.boolean().default(false).describe('Also use the soundtrack of the video reference'),
      audios: z.array(z.string()).max(3).default([]).describe('Up to 3 audio reference file names'),
      ratio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
      megapixels: z.enum(['0.4', '0.7', '1', '1.2', '1.5', '2']).default('0.7').describe('Output size preset: 0.4 Draft (864x480), 0.7 Balanced (1152x640), 1 (1376x768), 1.2 (1504x832), 1.5 (1632x928), 2 (1920x1088)'),
      duration: z.number().int().min(5).max(20).default(5).describe('Seconds, 5-20'),
      steps: z.number().int().min(1).max(50).default(10).describe('Sampling steps; the Turbo LoRA default is 10'),
      seed: z.number().int().min(0).max(4294967295).optional().describe('Fixed seed for reproducibility; random when omitted')
    }
  }, guard(async ({ prompt, images = [], video, video_audio = false, audios = [], ratio = '16:9', megapixels = '0.7', duration = 5, steps = 10, seed }) => {
    const status = await pageStatus();
    if (!status.models_ready || !status.comfy_ready) throw new ToolError(status.download_error ? 'Model download failed on the Pod; restart the Pod. ' + status.download_error : `Pod not ready yet: models ${status.progress ?? 0}% downloaded, ComfyUI ${status.comfy_ready ? 'running' : 'starting'}. Retry in a minute.`);
    const imageNames = await Promise.all(images.map(name => requireReference(name, 'image')));
    const videoNames = video ? [await requireReference(video, 'video')] : [];
    const audioNames = await Promise.all(audios.map(name => requireReference(name, 'audio')));
    const finalSeed = seed ?? crypto.randomInt(0, 4294967296);
    let workflow;
    try { workflow = buildWorkflow({ prompt, ratio, megapixels: Number(megapixels), duration, steps, seed: finalSeed, images: imageNames, videos: videoNames, audios: audioNames, videoAudio: video_audio && videoNames.length > 0 }); } catch (error) { throw new ToolError(error.message); }
    const submitted = await comfy('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'tony-mcp-' + crypto.randomUUID() }) });
    if (!submitted.prompt_id) throw new ToolError('ComfyUI did not return a job id: ' + JSON.stringify(submitted));
    const tags = {};
    imageNames.forEach((name, i) => { tags[`<Picture ${i + 1}>`] = name; });
    let audioIndex = 1;
    if (videoNames.length) { tags['<Video 1>'] = videoNames[0]; if (video_audio) tags[`<Audio ${audioIndex++}>`] = videoNames[0] + ' (soundtrack)'; }
    audioNames.forEach(name => { tags[`<Audio ${audioIndex++}>`] = name; });
    const [width, height] = ratio === '9:16' ? [...SIZES[megapixels]].reverse() : ratio === '1:1' ? [workflow.reference.inputs.width, workflow.reference.inputs.height] : SIZES[megapixels];
    return { job_id: submitted.prompt_id, seed: finalSeed, queue_position: submitted.number ?? null, width, height, duration_seconds: duration, steps, tags, next: 'Poll tony_job_status with this job_id every 15-30 seconds.' };
  }));

  server.registerTool('tony_job_status', {
    title: 'Job status',
    description: 'Checks a generation job. Returns queued/running/done/error; when done includes video_url that the user can open or download.',
    inputSchema: { job_id: z.string().min(1) }
  }, guard(async ({ job_id }) => {
    const queue = await comfy('/queue');
    const running = (queue.queue_running || []).some(item => item?.[1] === job_id);
    if (running) return { job_id, status: 'running', ahead: 0, next: 'Poll again in 15-30 seconds.' };
    const pendingIndex = (queue.queue_pending || []).findIndex(item => item?.[1] === job_id);
    if (pendingIndex >= 0) return { job_id, status: 'queued', ahead: pendingIndex + (queue.queue_running?.length ?? 0), next: 'Poll again in 15-30 seconds.' };
    const history = await comfy('/history/' + encodeURIComponent(job_id));
    const entry = history[job_id];
    if (!entry) return { job_id, status: 'unknown', detail: 'Job is neither queued nor in ComfyUI history; it may have been cancelled or the Pod restarted.' };
    return summarizeHistoryEntry(job_id, entry);
  }));

  server.registerTool('tony_history', {
    title: 'Recent videos',
    description: 'Lists recently finished Tony H3 videos on this Pod with their seeds, sizes and video_url values. Prompts are not stored.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) }
  }, guard(async ({ limit = 10 }) => {
    const history = await comfy('/history?max_items=200');
    const jobs = Object.entries(history).filter(([, entry]) => isTonyJob(entry)).map(([id, entry]) => summarizeHistoryEntry(id, entry)).reverse().slice(0, limit);
    return { count: jobs.length, jobs };
  }));

  server.registerTool('tony_cancel', {
    title: 'Cancel job',
    description: 'Removes a queued job or interrupts the running one.',
    inputSchema: { job_id: z.string().min(1) }
  }, guard(async ({ job_id }) => {
    const queue = await comfy('/queue');
    if ((queue.queue_running || []).some(item => item?.[1] === job_id)) { await comfy('/interrupt', { method: 'POST' }); return { job_id, cancelled: true, was: 'running' }; }
    if ((queue.queue_pending || []).some(item => item?.[1] === job_id)) { await comfy('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [job_id] }) }); return { job_id, cancelled: true, was: 'queued' }; }
    return { job_id, cancelled: false, detail: 'Job is not queued or running.' };
  }));

  return server;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function codeMatches(candidate) {
  const expected = Buffer.from(CONFIG.code), given = Buffer.from(candidate || '');
  return expected.length > 0 && expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function createHttpServer(config = {}) {
  const { enableImages = CONFIG.enableImages, ...serverConfig } = config;
  Object.assign(CONFIG, serverConfig);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, version: VERSION });
    const match = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (!match || !codeMatches(decodeURIComponent(match[1]))) return sendJson(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST (stateless Streamable HTTP).' }, id: null });
    const server = createServer({ enableImages });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[TONY MCP] request failed', error);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!CONFIG.code) { console.error('[TONY MCP] TONY_MCP_CODE is required'); process.exit(1); }
  createHttpServer().listen(CONFIG.port, CONFIG.host, () => {
    console.log(`[TONY MCP] v${VERSION} listening on ${CONFIG.host}:${CONFIG.port}; ComfyUI ${CONFIG.comfy}; input ${CONFIG.inputDir}`);
  });
}
