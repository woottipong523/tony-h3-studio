/* Shared by the browser MVC views and Tony MCP server. */
(function (root) {
  const MODELS = {
    original: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    singularity: 'Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors',
    'original-bf16': 'minimax_h3_ref2va_bf16.safetensors'
  };
  function buildWorkflow({prompt, ratio, megapixels, duration, steps, seed = Math.floor(Math.random() * 0x100000000), model, images = [], videos = [], audios = [], videoAudio = false, attentionMode = 'global_sage', loraStrength = 0.85, sampler = 'res_multistep'}) {
    const envProfile = typeof process !== 'undefined' ? (process.env?.TONY_MODEL_PROFILE || process.env?.KENDO_MODEL_PROFILE) : undefined;
    const selectedModel = model || (envProfile === 'quality' ? 'original-bf16' : 'original');
    if (images.length > 9 || videos.length > 1 || audios.length > 3) throw new Error('Reference limit exceeded');
    if (!prompt || !prompt.trim()) throw new Error('Prompt is required');
    if (!(duration >= 5 && duration <= 20) || !(steps >= 1 && steps <= 50)) throw new Error('Invalid generation settings');
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Invalid seed');
    if (!MODELS[selectedModel]) throw new Error('Invalid model');
    const parsedLora = Number(loraStrength);
    if (!Number.isFinite(parsedLora) || parsedLora < 0 || parsedLora > 1.5) throw new Error('Invalid LoRA strength');
    const validSamplers = ['euler', 'res_multistep'];
    const selectedSampler = validSamplers.includes(sampler) ? sampler : 'res_multistep';
    const sizes = {'0.4':[864,480], '0.7':[1152,640], '1':[1376,768], '1.2':[1504,832], '1.5':[1632,928], '2':[1920,1088]};
    if (!sizes[String(megapixels)] || !['16:9','9:16','1:1'].includes(ratio)) throw new Error('Invalid resolution');
    let [width,height] = sizes[String(megapixels)];
    if (ratio === '9:16') [width,height] = [height,width];
    if (ratio === '1:1') width = height = Math.round(Math.sqrt(megapixels * 1e6) / 32) * 32;
    const frames = Math.ceil((Math.round(duration * 24) - 5) / 17) * 17 + 5;
    const n = (class_type, inputs) => ({class_type, inputs});
    const w = {
      model:n('UNETLoader',{unet_name:MODELS[selectedModel],weight_dtype:'default'}),
      turbo:n('LoraLoaderModelOnly',{lora_name:'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',strength_model:Math.round(parsedLora * 100) / 100,model:['model',0]}),
      clip:n('CLIPLoader',{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}),
      vae:n('VAELoader',{vae_name:'minimax_h3_video_vae_fp16.safetensors'}),
      audioVae:n('VAELoader',{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}),
      reference:n('MiniMaxH3ReferenceToVideo',{prompt,width,height,length:frames,ref_image_size:'match',clip:['clip',0],vae:['vae',0],audio_vae:['audioVae',0]}),
      noise:n('RandomNoise',{noise_seed:seed}),
      guider:n('BasicGuider',{model:['turbo',0],conditioning:['reference',0]}),
      sampler:n('KSamplerSelect',{sampler_name:selectedSampler}),
      schedule:n('BasicScheduler',{scheduler:'simple',steps,denoise:1,model:['turbo',0]}),
      sample:n('SamplerCustomAdvanced',{noise:['noise',0],guider:['guider',0],sampler:['sampler',0],sigmas:['schedule',0],latent_image:['reference',1]}),
      decode:n('VAEDecode',{samples:['sample',0],vae:['vae',0]}),
      decodeAudio:n('VAEDecodeAudio',{samples:['sample',0],vae:['audioVae',0]}),
      video:n('CreateVideo',{fps:24,bit_depth:8,images:['decode',0],audio:['decodeAudio',0]}),
      save:n('SaveVideo',{filename_prefix:selectedModel==='original-bf16'?'video/Tony_H3_V4_Quality':selectedModel==='singularity'?'video/Tony_H3_v3_Singularity':'video/Tony_H3_v3',format:'auto',codec:'auto',video:['video',0]})
    };
    if (!['global_sage','kj_memory'].includes(attentionMode)) throw new Error('Invalid attention mode');
    const localRuntime = root.TONY_LOCAL_RUNTIME || root.KENDO_LOCAL_RUNTIME;
    if (attentionMode === 'kj_memory' && localRuntime?.kj_sage_available) {
      w.sage = n('MiniMaxH3MemoryEfficientSageAttentionPatch',{model:['turbo',0]});
      w.guider.inputs.model = ['sage',0];
      w.schedule.inputs.model = ['sage',0];
    }
    images.forEach((image,i)=>{w['image'+i]=n('LoadImage',{image});w.reference.inputs['ref_images.ref_image_'+i]=['image'+i,0]});
    videos.forEach((video,i)=>{
      w['refVideo'+i]=n('VHS_LoadVideo',{video,force_rate:24,custom_width:0,custom_height:0,frame_load_cap:frames,skip_first_frames:0,select_every_nth:1});
      w.reference.inputs['ref_videos.ref_video_'+i]=['refVideo'+i,0];
      if(videoAudio) w.reference.inputs['ref_video_audios.ref_video_audio_'+i]=['refVideo'+i,2];
    });
    audios.forEach((audio,i)=>{w['audio'+i]=n('LoadAudio',{audio});w.reference.inputs['ref_audios.ref_audio_'+i]=['audio'+i,0]});
    return w;
  }
  const exported = {buildWorkflow, MODELS};
  if (typeof module !== 'undefined') module.exports = exported;
  else {
    root.TonyWorkflow = exported;
    root.KendoWorkflow = exported;
  }
})(globalThis);

