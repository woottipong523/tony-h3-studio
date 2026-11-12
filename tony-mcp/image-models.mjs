// KIE's documented task schemas and listed prices, checked 2026-10-12.
// Kept on the server so HTTP and MCP use exactly the same model catalogue.
const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'];
export const IMAGE_MODELS = {
  'seedream-5-pro': {
    name: 'Seedream 5.0 Pro', provider: 'ByteDance', description: 'ภาพถ่าย งานออกแบบ และการแก้ภาพหลายภาพอ้างอิง',
    textModel: 'seedream/5-pro-text-to-image', editModel: 'seedream/5-pro-image-to-image',
    maxImages: 10, maxBytes: 30 * 1024 * 1024, minPrompt: 4, maxPrompt: 5000,
    ratios, resolutions: ['1K', '2K'], formats: ['png', 'jpeg'],
    rates: {'1K': .035, '2K': .07}, referenceRate: .0025, freeReferences: 1,
    docs: 'https://docs.kie.ai/market/seedream/5-pro-text-to-image', pricing: 'https://kie.ai/seedream-5-0-pro'
  },
  'flux-2-pro': {
    name: 'FLUX.2 Pro', provider: 'Black Forest Labs', description: 'ภาพถ่ายสินค้า รายละเอียด และภาพอ้างอิงหลายภาพ',
    textModel: 'flux-2/pro-text-to-image', editModel: 'flux-2/pro-image-to-image',
    maxImages: 8, maxBytes: 10 * 1024 * 1024, minPrompt: 3, maxPrompt: 5000,
    ratios: ratios.filter(r => r !== '21:9'), resolutions: ['1K', '2K'], formats: [],
    rates: {'1K': .025, '2K': .035}, referenceRate: 0, freeReferences: 0,
    docs: 'https://docs.kie.ai/market/flux2/pro-text-to-image', pricing: 'https://kie.ai/flux-2'
  },
  'qwen-3-pro': {
    name: 'Qwen Image 3.0 Pro', provider: 'Alibaba', description: 'ข้อความในภาพ เลย์เอาต์ และการแก้ภาพ · ผ่าน KIE',
    textModel: 'qwen3/pro-text-to-image', editModel: 'qwen3/pro-image-to-image',
    maxImages: 3, maxBytes: 10 * 1024 * 1024, minPrompt: 1, maxPrompt: 5000,
    ratios, resolutions: ['1K', '2K'], formats: ['png', 'jpeg'],
    rates: {'1K': .032, '2K': .06}, referenceRate: .0025, freeReferences: 0,
    docs: 'https://docs.kie.ai/market/qwen3-pro/text-to-image', pricing: 'https://kie.ai/qwen-image-3'
  },
  'grok-image-2': {
    name: 'Grok Imagine Image 2.0', provider: 'xAI', description: 'ภาพสร้างสรรค์และการแก้ภาพ · ความละเอียดตามโมเดล',
    textModel: 'grok-imagine-image-2-0/text-to-image', editModel: 'grok-imagine-image-2-0/image-edit',
    maxImages: 5, maxBytes: 30 * 1024 * 1024, minPrompt: 1, maxPrompt: 8000,
    ratios: ['1:1', '2:3', '3:2', '16:9', '9:16'], resolutions: ['native'], formats: [],
    rates: {native: .02}, referenceRate: 0, freeReferences: 0,
    docs: 'https://docs.kie.ai/market/grok-imagine-image-2-0/text-to-image', pricing: 'https://kie.ai/grok-imagine-image-2'
  },
  'nano-banana-pro': {
    name: 'Nano Banana Pro', provider: 'Google', description: 'งานภาพและข้อความ พร้อมภาพอ้างอิง · สูงสุด 4K',
    textModel: 'nano-banana-pro', editModel: 'nano-banana-pro',
    maxImages: 8, maxBytes: 30 * 1024 * 1024, minPrompt: 1, maxPrompt: 20000,
    ratios: [...ratios, '4:5', '5:4'], resolutions: ['1K', '2K', '4K'], formats: ['png', 'jpg'],
    rates: {'1K': .09, '2K': .09, '4K': .12}, referenceRate: 0, freeReferences: 0,
    docs: 'https://docs.kie.ai/market/google/pro-image-to-image', pricing: 'https://kie.ai/nano-banana-pro'
  },
  'gpt-image-2': {
    name: 'GPT Image 2', provider: 'OpenAI', description: 'ภาพถ่าย ข้อความ และภาพอ้างอิงสูงสุด 16 ภาพ · สูงสุด 4K',
    textModel: 'gpt-image-2-text-to-image', editModel: 'gpt-image-2-image-to-image',
    maxImages: 16, maxBytes: 30 * 1024 * 1024, minPrompt: 1, maxPrompt: 20000,
    // This subset is supported at every exposed resolution, including 2K.
    ratios, resolutions: ['1K', '2K', '4K'], formats: [],
    rates: {'1K': .03, '2K': .05, '4K': .08}, referenceRate: 0, freeReferences: 0,
    docs: 'https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image', pricing: 'https://kie.ai/gpt-image-2'
  }
};
export const IMAGE_MODEL_IDS = Object.keys(IMAGE_MODELS);
export function imageEstimate(model, resolution, references = 0) {
  return Number((model.rates[resolution] + Math.max(0, references - model.freeReferences) * model.referenceRate).toFixed(4));
}
