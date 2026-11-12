import { z } from 'zod';
import { createKieService, IMAGE_RATIOS, VIDEO_RATIOS } from './kie-client.mjs';
import { IMAGE_MODELS, IMAGE_MODEL_IDS } from './image-models.mjs';

export function registerKieTools(server, service = createKieService()) {
  const guard = handler => async args => {
    try { const data = await handler(args ?? {}); return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }; }
    catch (error) { return { content: [{ type: 'text', text: error.message }], isError: true }; }
  };
  const common = {
    prompt: z.string().min(1),
    reference_urls: z.array(z.string().url()).default([]).describe('Public HTTPS image URLs in reference order'),
    request_id: z.string().min(8).max(100).describe('Stable ID for this generation. Reuse the SAME ID on retries, never automatically resubmit with a new ID.'),
    confirm_cost: z.literal(true).describe('Only true after the user authorizes this paid generation')
  };
  server.registerTool('kie_status', { title: 'KIE connection status', description: 'Check whether the shared server-side KIE API key is configured. Does not spend credits.' }, guard(async () => ({ configured: service.configured(), models: ['Seedance 2.0', 'Seedance 2.5', ...Object.values(IMAGE_MODELS).map(m => m.name)], next: 'Read kie_image_models, then use kie_image_generate or kie_seedance_generate for an authorized paid request. Poll kie_job_status for results.' })));
  server.registerTool('kie_image_models', { title: 'Available KIE image models', description: 'Read supported model IDs, resolutions, reference limits and approximate USD prices. No credits spent. Output format is provider-controlled when formats is empty.' }, guard(async () => ({ models: IMAGE_MODELS, checked_at: '2026-10-12' })));
  server.registerTool('kie_image_generate', {
    title: 'Create an image with a selected KIE model',
    description: 'PAID: Seedream, FLUX, Qwen, Grok, Nano Banana Pro or GPT Image using the SAME server-side KIE key and Studio history. Read kie_image_models for per-model limits and prices before requesting cost authorization. Uses image-to-image automatically when references are present. Poll kie_job_status. Never automatically resubmit.',
    inputSchema: { ...common, model: z.enum(IMAGE_MODEL_IDS).default('seedream-5-pro'), reference_urls: z.array(z.string().url()).max(16).default([]), ratio: z.string().default('1:1'), resolution: z.enum(['1K', '2K', '4K', 'native']).optional(), output_format: z.enum(['png', 'jpeg', 'jpg']).optional() }
  }, guard(args => service.submit({ ...args, kind: 'image' })));
  server.registerTool('kie_seedream_generate', {
    title: 'Create an image with Seedream 5.0 Pro',
    description: 'PAID: Create one image via KIE, automatically selecting text-to-image or image-to-image. 1K costs $0.035; 2K costs $0.07; first input image free, additional inputs $0.0025 each. Up to 10 references. Returns a task ID; poll kie_job_status.',
    inputSchema: { ...common, prompt: z.string().min(4).max(5000), reference_urls: z.array(z.string().url()).max(10).default([]), ratio: z.enum(IMAGE_RATIOS).default('1:1'), quality: z.enum(['basic', 'high']).default('basic'), output_format: z.enum(['png', 'jpeg']).default('png') }
  }, guard(args => service.submit({ ...args, kind: 'image' })));
  server.registerTool('kie_seedance_generate', {
    title: 'Create a video with Seedance 2.0 or 2.5',
    description: 'PAID via KIE. model seedance-2-5 (default): 30 references, 4–30s, 480p $0.14/s, 720p $0.315/s, 1080p $0.79/s. model seedance-2: 9 references, 4–15s, 480p $0.095/s, 720p $0.205/s, 1080p $0.51/s, 4k $1.04/s. Text/image input only. Poll kie_job_status; never resubmit automatically.',
    inputSchema: { ...common, model: z.enum(['seedance-2', 'seedance-2-5']).default('seedance-2-5'), prompt: z.string().min(1).max(30000), reference_urls: z.array(z.string().url()).max(30).default([]), ratio: z.enum(VIDEO_RATIOS).default('16:9'), resolution: z.enum(['480p', '720p', '1080p', '4k']).default('720p'), duration: z.number().int().min(4).max(30).default(10), generate_audio: z.boolean().default(true) }
  }, guard(args => service.submit({ ...args, kind: 'video' })));
  server.registerTool('kie_job_status', { title: 'KIE task status', description: 'Read a Studio KIE task; saves successful images/videos to the persistent Studio result directory. Never creates a new paid task.', inputSchema: { task_id: z.string().min(1) } }, guard(({ task_id }) => service.getJob(task_id)));
  server.registerTool('kie_history', { title: 'KIE Studio history', description: 'Read recent image and video tasks shared with the Studio page. Does not spend credits.' }, guard(async () => ({ jobs: await service.history() })));
}
