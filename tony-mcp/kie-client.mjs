// Shared by the Studio HTTP API and the existing Tony MCP tools.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { IMAGE_MODELS, IMAGE_MODEL_IDS, imageEstimate } from './image-models.mjs';

export const IMAGE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'];
export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
export const MODELS = { image: 'seedream/5-pro-text-to-image', imageReference: 'seedream/5-pro-image-to-image', video: 'bytedance/seedance-2-5' };
export const VIDEO_MODELS = {
  'seedance-2-5': { model: 'bytedance/seedance-2-5', maxImages: 30, maxDuration: 30, maxPrompt: 30000, rates: { '480p': .14, '720p': .315, '1080p': .79 } },
  'seedance-2': { model: 'bytedance/seedance-2', maxImages: 9, maxDuration: 15, maxPrompt: 20000, rates: { '480p': .095, '720p': .205, '1080p': .51, '4k': 1.04 } }
};
export class KieError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function choose(value, options, label) {
  if (!options.includes(value)) throw new KieError(`Invalid ${label}`);
  return value;
}
export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new KieError('Invalid image URL'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || host.endsWith('.localhost') || host.includes(':') || /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)) throw new KieError('Use a public HTTPS image URL');
  return url.href;
}
export function buildKiePayload(args = {}) {
  const kind = choose(args.kind, ['image', 'video'], 'kind');
  const imageId = kind === 'image' ? choose(args.model ?? 'seedream-5-pro', IMAGE_MODEL_IDS, 'image model') : null;
  const image = IMAGE_MODELS[imageId];
  const video = kind === 'video' ? VIDEO_MODELS[choose(args.model ?? 'seedance-2-5', Object.keys(VIDEO_MODELS), 'video model')] : null;
  const maxPrompt = image?.maxPrompt ?? video.maxPrompt;
  const maxImages = image?.maxImages ?? video.maxImages;
  const minPrompt = image?.minPrompt ?? 1;
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (prompt.length < minPrompt || prompt.length > maxPrompt) throw new KieError(`Prompt must contain ${minPrompt}-${maxPrompt} characters`);
  const references = args.reference_urls ?? [];
  if (!Array.isArray(references) || references.length > maxImages) throw new KieError(`Maximum ${maxImages} image references`);
  const urls = references.map(publicUrl);
  const input = { prompt, aspect_ratio: choose(args.ratio ?? (image ? '1:1' : '16:9'), image?.ratios ?? VIDEO_RATIOS, 'aspect ratio') };
  let estimate;
  if (kind === 'image') {
    if (args.quality !== undefined && imageId !== 'seedream-5-pro') throw new KieError('quality is only supported by Seedream');
    if (args.quality !== undefined) choose(args.quality, ['basic', 'high'], 'quality');
    const resolution = choose(args.resolution ?? (args.quality ? (args.quality === 'high' ? '2K' : '1K') : image.resolutions.includes('2K') ? '2K' : 'native'), image.resolutions, 'resolution');
    if (args.quality && args.resolution && (args.quality === 'high' ? '2K' : '1K') !== resolution) throw new KieError('quality and resolution conflict');
    if (image.formats.length) input.output_format = choose(args.output_format ?? 'png', image.formats, 'output format');
    else if (args.output_format !== undefined) throw new KieError('This model chooses its output format');
    if (imageId === 'seedream-5-pro') {
      input.quality = resolution === '2K' ? 'high' : 'basic'; input.nsfw_checker = true;
      if (urls.length) input.image_urls = urls;
    } else if (imageId === 'flux-2-pro') {
      input.resolution = resolution; input.nsfw_checker = true;
      if (urls.length) input.input_urls = urls;
    } else if (imageId === 'qwen-3-pro') {
      input.resolution = resolution; input.image_size = input.aspect_ratio; delete input.aspect_ratio;
      input.prompt_extend = true; input.nsfw_checker = true;
      if (urls.length) input.image_urls = urls;
    } else if (imageId === 'nano-banana-pro') {
      input.resolution = resolution; input.image_input = urls;
    } else if (imageId === 'gpt-image-2') {
      input.resolution = resolution;
      if (urls.length) input.input_urls = urls;
    } else if (urls.length) input.image_urls = urls;
    estimate = imageEstimate(image, resolution, urls.length);
  } else {
    input.resolution = choose(args.resolution ?? '720p', Object.keys(video.rates), 'resolution');
    input.duration = args.duration ?? 10;
    if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > video.maxDuration) throw new KieError(`Duration must be an integer from 4 to ${video.maxDuration} seconds`);
    if (args.generate_audio !== undefined && typeof args.generate_audio !== 'boolean') throw new KieError('generate_audio must be boolean');
    input.generate_audio = args.generate_audio ?? true;
    if (args.model !== 'seedance-2') input.output_format = 'mp4';
    if (urls.length) input.reference_image_urls = urls;
    estimate = video.rates[input.resolution] * input.duration;
  }
  return { payload: { model: kind === 'image' ? (urls.length ? image.editModel : image.textModel) : video.model, input }, estimate_usd: Number(estimate.toFixed(4)), kind };
}

export function createKieService(options = {}) {
  const fetcher = options.fetchImpl ?? fetch;
  const dataDir = options.dataDir ?? process.env.TONY_KIE_DATA_DIR ?? process.env.KENDO_KIE_DATA_DIR ?? fileURLToPath(new URL('../.tony-kie/', import.meta.url));
  const apiBase = options.apiBase ?? 'https://api.kie.ai';
  const uploadUrl = options.uploadUrl ?? 'https://kieai.redpandaai.co/api/file-stream-upload';
  const keyFile = path.join(dataDir, 'api-key');
  const key = () => {
    if (options.apiKey !== undefined) return options.apiKey.trim();
    try { return readFileSync(keyFile, 'utf8').trim(); } catch (e) { if (e.code !== 'ENOENT') throw new KieError('Cannot read the saved KIE key', 503); }
    return (process.env.KIE_API_KEY ?? '').trim();
  };
  async function setApiKey(value) {
    if (typeof value !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(value.trim())) throw new KieError('กรุณาใส่ KIE API Key ที่ถูกต้อง');
    await fs.mkdir(dataDir, { recursive: true });
    const temporary = keyFile + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, value.trim(), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, keyFile);
      await fs.chmod(keyFile, 0o600);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    return { configured: true };
  }
  const inProgress = new Map();
  const pendingSubmissions = new Map();
  const jobsDir = path.join(dataDir, 'jobs');
  const resultsDir = path.join(dataDir, 'results');
  function taskId(value) {
    if (typeof value !== 'string' || !/^[\w-]{1,180}$/.test(value)) throw new KieError('Invalid task ID');
    return value;
  }
  async function request(url, init = {}) {
    if (!key()) throw new KieError('KIE_API_KEY is not configured on the server', 503);
    let response;
    try { response = await fetcher(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${key()}` }, redirect: 'error', signal: AbortSignal.timeout(120000) }); }
    catch { throw new KieError('KIE connection failed. Do not resubmit a generation automatically; check the KIE task logs first.', 502); }
    let body;
    try { body = await response.json(); } catch { throw new KieError('KIE returned an invalid response', 502); }
    if (!response.ok || body.code !== 200 || body.success === false) {
      // Never return upstream messages that might echo credentials or request bodies.
      throw new KieError(`KIE rejected the request (HTTP ${response.status}, code ${Number(body.code) || 'unknown'}). Check KIE Logs.`, response.status === 401 ? 401 : 502);
    }
    return body.data ?? {};
  }
  async function saveJob(job) {
    await fs.mkdir(jobsDir, { recursive: true });
    const target = path.join(jobsDir, taskId(job.task_id) + '.json');
    const temporary = target + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(job));
    await fs.rename(temporary, target);
    return job;
  }
  async function readJob(id) {
    try { return JSON.parse(await fs.readFile(path.join(jobsDir, taskId(id) + '.json'), 'utf8')); }
    catch (e) { if (e instanceof KieError) throw e; throw new KieError('Task is not in this Studio history', 404); }
  }
  async function history() {
    let names;
    try { names = await fs.readdir(jobsDir); } catch { return []; }
    const jobs = [];
    for (const name of names.filter(name => /^[\w-]+\.json$/.test(name))) {
      try { jobs.push(JSON.parse(await fs.readFile(path.join(jobsDir, name), 'utf8'))); } catch {}
    }
    return jobs.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
  }
  async function submit(args) {
    const built = buildKiePayload(args);
    const requestId = args.request_id;
    if (typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId)) throw new KieError('A stable request_id is required to prevent duplicate paid requests');
    const hash = crypto.createHash('sha256').update(JSON.stringify(built.payload)).digest('hex');
    const run = async () => {
      await fs.mkdir(path.join(dataDir, 'requests'), { recursive: true });
      const receipt = path.join(dataDir, 'requests', requestId + '.json');
      // Exclusive durable receipt protects against duplicate browser/MCP calls and restarts.
      try { await fs.writeFile(receipt, JSON.stringify({ hash, state: 'submitting' }), { flag: 'wx' }); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const previous = JSON.parse(await fs.readFile(receipt, 'utf8'));
        if (previous.hash !== hash) throw new KieError('request_id was already used with different settings', 409);
        if (previous.task_id) return readJob(previous.task_id);
        throw new KieError('This request may already have been sent. Check KIE Logs before creating another request.', 409);
      }
      if (!key()) { await fs.unlink(receipt); throw new KieError('KIE_API_KEY is not configured on the server', 503); }
      const data = await request(apiBase + '/api/v1/jobs/createTask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(built.payload) });
      const id = taskId(data.taskId);
      // Record the provider ID before any other persistence to recover after local write failures.
      await fs.writeFile(receipt, JSON.stringify({ hash, task_id: id, state: 'submitted' }));
      return saveJob({ task_id: id, request_id: requestId, kind: built.kind, model: built.payload.model, state: 'waiting', estimate_usd: built.estimate_usd, created_at: new Date().toISOString(), result_urls: [], remote_urls: [] });
    };
    const pending = pendingSubmissions.get(requestId);
    if (pending && pending.hash !== hash) throw new KieError('request_id was already used with different settings', 409);
    if (!pending) pendingSubmissions.set(requestId, { hash, promise: run().finally(() => pendingSubmissions.delete(requestId)) });
    return pendingSubmissions.get(requestId).promise;
  }
  async function uploadImage(buffer, mime, name = 'reference') {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 30 * 1024 * 1024) throw new KieError('Image must be between 1 byte and 30 MB');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
    const png = buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const webp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!extension || !({ 'image/png': png, 'image/jpeg': jpg, 'image/webp': webp }[mime])) throw new KieError('Use a valid PNG, JPG or WEBP image');
    const fileName = (name.replace(/[^\w-]/g, '-').slice(0, 35) || 'reference') + '-' + crypto.randomUUID() + '.' + extension;
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), fileName);
    form.append('uploadPath', 'images/tony-studio');
    form.append('fileName', fileName);
    const data = await request(uploadUrl, { method: 'POST', body: form });
    return { url: publicUrl(data.downloadUrl) };
  }
  async function downloadResult(url, id, index, kind) {
    publicUrl(url);
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new KieError('Result download failed; use the original KIE URL to download now', 502);
    const mime = (response.headers.get('content-type') ?? '').split(';')[0];
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' }[mime];
    if (!extension || (kind === 'image' && !mime.startsWith('image/')) || (kind === 'video' && !mime.startsWith('video/'))) throw new KieError('Unexpected result file type', 502);
    const filename = `result-${index + 1}.${extension}`;
    const folder = path.join(resultsDir, id);
    await fs.mkdir(folder, { recursive: true });
    const destination = path.join(folder, filename);
    const temporary = destination + '.' + crypto.randomUUID() + '.part';
    const handle = await fs.open(temporary, 'wx');
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 300 * 1024 * 1024) throw new KieError('Result exceeds 300 MB', 502);
        await handle.write(chunk);
      }
      if (!bytes) throw new KieError('Empty result file', 502);
      await handle.close();
      await fs.rename(temporary, destination);
    } catch (error) { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); throw error; }
    return `/api/kie/results/${encodeURIComponent(id)}/${filename}`;
  }
  async function refreshJob(id) {
    const job = await readJob(id);
    if (job.state === 'success' && job.result_urls.length || job.state === 'fail') return job;
    const data = await request(apiBase + '/api/v1/jobs/recordInfo?taskId=' + encodeURIComponent(id));
    job.state = data.state ?? 'waiting';
    if (job.state === 'fail') job.error = 'KIE generation failed. Check the task in KIE Logs.';
    if (job.state === 'success') {
      let result;
      try { result = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson; }
      catch { throw new KieError('KIE returned invalid result data', 502); }
      if (!Array.isArray(result?.resultUrls) || !result.resultUrls.length) throw new KieError('KIE completed the task without a result URL', 502);
      job.remote_urls = result.resultUrls.map(publicUrl);
      job.result_urls = [];
      try {
        for (const [index, url] of job.remote_urls.entries()) job.result_urls.push(await downloadResult(url, id, index, job.kind));
        delete job.download_error;
      } catch { job.download_error = 'Could not save the result locally. Download from the KIE result URL before it expires.'; }
    }
    return saveJob(job);
  }
  function getJob(id) {
    taskId(id);
    if (!inProgress.has(id)) inProgress.set(id, refreshJob(id).finally(() => inProgress.delete(id)));
    return inProgress.get(id);
  }
  async function resultFile(id, filename) {
    taskId(id);
    if (!/^result-\d+\.(png|jpg|webp|mp4|mov)$/.test(filename)) throw new KieError('Invalid result filename', 404);
    await readJob(id);
    return path.join(resultsDir, id, filename);
  }
  return { configured: () => Boolean(key()), setApiKey, submit, uploadImage, getJob, history, resultFile };
}
