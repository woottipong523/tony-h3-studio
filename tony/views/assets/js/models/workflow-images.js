/* Native ComfyUI graph based on Comfy-Org's Qwen Image 2.1 templates. */
(function(root) {
  'use strict';
  const MODELS = {
    'qwen21-turbo': { name: 'Qwen Image 2.1 Turbo', diffusion: 'qwen_image_2.1_turbo_int8_convrot.safetensors', steps: 8 },
    qwen21: { name: 'Qwen Image 2.1', diffusion: 'qwen_image_2.1_int8_convrot.safetensors', steps: 40 },
    'qwen21-klein': { name: 'Qwen 2.1 + Flux Klein 9B', diffusion: 'qwen_image_2.1_bf16.safetensors', encoder: 'qwen3vl_8b_fp8_scaled.safetensors', steps: 30, textOnly: true }
  };
  const ENCODER = 'qwen3vl_8b_int8_convrot.safetensors', VAE = 'qwen_image_2.1_vae_bf16.safetensors';
  const REQUIRED = ['UNETLoader','CLIPLoader','VAELoader','TextEncodeQwenImage21','EmptyLatentImage','KSampler','VAEDecode','SaveImage'];
  const KLEIN = {diffusion:'flux-2-klein-9b-fp8.safetensors',encoder:'qwen_3_8b.safetensors',vae:'flux2-vae.safetensors'};
  const ATTACHED_LORA = 'RLY-thot_shot-QWEN21-helena-v1a-trigger-rlyhelena.safetensors';
  const KLEIN_REQUIRED = ['UNETLoader','CLIPLoader','VAELoader','CLIPTextEncode','EmptyLatentImage','KSamplerSelect','DetailDaemonSamplerNode','BasicScheduler','SamplerCustom','VAEDecode','ImageSharpen','ImageScaleToTotalPixels','GetImageSize','VAEEncode','ReferenceLatent','ConditioningZeroOut','CFGGuider','RandomNoise','Flux2Scheduler','EmptyFlux2LatentImage','SamplerCustomAdvanced','ColorMatch','SaveImage'];
  const NEGATIVE = 'blurry, low resolution, low quality image, distorted limbs, eerie appearance, ugly, AI feel, noise, grid artifacts, JPEG compression stripes, abnormal limbs, watermark, garbled text, meaningless characters, bluish tint';
  // User-supplied Qwen 2.1 / Flux Klein graph. Bypassed LoRAs and disconnected nodes
  // are excluded. The one active portrait LoRA is optional because its weights were
  // not attached. SaveImage replaces the original temporary preview outputs.
  function buildKlein(options, prompt, seed, steps, width, height) {
    if(options.references?.length) throw new Error('This attached workflow supports text-to-image only; choose Qwen native for reference editing');
    if(options.transparent) throw new Error('The attached Flux Klein workflow does not preserve transparency; choose Qwen native');
    const graph={};
    const add=(id,class_type,inputs)=>graph[id]={class_type,inputs};
    add('14','UNETLoader',{unet_name:options.diffusion??MODELS['qwen21-klein'].diffusion,weight_dtype:'default'});
    add('6','CLIPLoader',{clip_name:options.encoder??MODELS['qwen21-klein'].encoder,type:'qwen_image',device:'default'});
    add('1','VAELoader',{vae_name:options.vae??VAE});
    if(options.use_attached_lora) add('157','LoraLoaderModelOnly',{model:['14',0],lora_name:options.lora??ATTACHED_LORA,strength_model:1});
    const model=[options.use_attached_lora?'157':'14',0];
    add('5','CLIPTextEncode',{clip:['6',0],text:prompt});
    add('7','CLIPTextEncode',{clip:['6',0],text:NEGATIVE});
    add('10','EmptyLatentImage',{width,height,batch_size:1});
    add('137','KSamplerSelect',{sampler_name:'euler'});
    add('136','DetailDaemonSamplerNode',{sampler:['137',0],detail_amount:0.2,start:0.15,end:0.9,bias:0.5,exponent:1,start_offset:0,end_offset:0,fade:0,smooth:false,cfg_scale_override:0});
    add('141','BasicScheduler',{model,scheduler:'simple',steps,denoise:1});
    add('139','SamplerCustom',{model,positive:['5',0],negative:['7',0],sampler:['136',0],sigmas:['141',0],latent_image:['10',0],add_noise:true,noise_seed:seed,cfg:1});
    add('91','VAEDecode',{samples:['139',0],vae:['1',0]});
    add('144','ImageSharpen',{image:['91',0],sharpen_radius:1,sigma:0.5,alpha:0.5});
    add('56','ImageScaleToTotalPixels',{image:['144',0],upscale_method:'nearest-exact',megapixels:4,resolution_steps:2});
    add('58','GetImageSize',{image:['56',0]});
    add('63','UNETLoader',{unet_name:options.kleinDiffusion??KLEIN.diffusion,weight_dtype:'default'});
    add('62','CLIPLoader',{clip_name:options.kleinEncoder??KLEIN.encoder,type:'flux2',device:'default'});
    add('51','VAELoader',{vae_name:options.kleinVae??KLEIN.vae});
    add('54','CLIPTextEncode',{clip:['62',0],text:'Upscale the image in high definition, restore realistic skin texture, remove plastic looking skin, keep the entire image content unchanged.'});
    add('57','VAEEncode',{pixels:['56',0],vae:['51',0]});
    add('60','ReferenceLatent',{conditioning:['54',0],latent:['57',0]});
    add('55','ConditioningZeroOut',{conditioning:['54',0]});
    add('61','ReferenceLatent',{conditioning:['55',0],latent:['57',0]});
    add('52','CFGGuider',{model:['63',0],positive:['60',0],negative:['61',0],cfg:1});
    add('50','RandomNoise',{noise_seed:seed});
    add('47','KSamplerSelect',{sampler_name:'euler'});
    add('53','Flux2Scheduler',{steps:2,width:['58',0],height:['58',1]});
    add('59','EmptyFlux2LatentImage',{width:['58',0],height:['58',1],batch_size:1});
    add('48','SamplerCustomAdvanced',{noise:['50',0],guider:['52',0],sampler:['47',0],sigmas:['53',0],latent_image:['59',0]});
    add('49','VAEDecode',{samples:['48',0],vae:['51',0]});
    add('64','ColorMatch',{image_ref:['56',0],image_target:['49',0],method:'mkl',strength:0.8,multithread:true});
    add('65','ImageSharpen',{image:['64',0],sharpen_radius:1,sigma:0.3,alpha:0.3});
    add('161','SaveImage',{images:['144',0],filename_prefix:'Tony_Qwen21_Klein_before'});
    add('162','SaveImage',{images:['65',0],filename_prefix:'Tony_Qwen21_Klein_after'});
    return graph;
  }
  function dimensions(ratio, resolution) {
    const allowed = ['1:1','4:3','3:4','3:2','2:3','16:9','9:16'];
    if (!allowed.includes(ratio) || ![1024,2048].includes(Number(resolution))) throw new Error('Invalid image dimensions');
    const [w,h] = ratio.split(':').map(Number), size = Number(resolution);
    return [Math.round(size*Math.sqrt(w/h)/32)*32, Math.round(size*Math.sqrt(h/w)/32)*32];
  }
  function buildWorkflow(options={}) {
    const spec = MODELS[options.model ?? 'qwen21-turbo'];
    if (!spec) throw new Error('Unknown image model');
    const prompt = String(options.prompt ?? '').trim();
    if (!prompt || prompt.length>5000) throw new Error('Prompt must contain 1–5000 characters');
    const references=options.references ?? [];
    if (!Array.isArray(references) || references.length>10 || references.some(n=>typeof n!=='string'||!n||n.includes('..')||n.startsWith('/'))) throw new Error('Invalid image references');
    const seed=Number(options.seed ?? 42), steps=Number(options.steps ?? spec.steps);
    if (!Number.isInteger(seed)||seed<0||seed>4294967295 || !Number.isInteger(steps)||steps<1||steps>80) throw new Error('Invalid seed or steps');
    const [width,height]=dimensions(options.ratio ?? '1:1',options.resolution ?? 1024);
    if(spec.textOnly) return buildKlein(options,prompt,seed,steps,width,height);
    const graph={
      '1': {class_type:'UNETLoader',inputs:{unet_name:options.diffusion ?? spec.diffusion,weight_dtype:'default'}},
      '2': {class_type:'CLIPLoader',inputs:{clip_name:options.encoder ?? ENCODER,type:'qwen_image',device:'default'}},
      '3': {class_type:'VAELoader',inputs:{vae_name:options.vae ?? VAE}},
      '4': {class_type:'TextEncodeQwenImage21',inputs:{clip:['2',0],prompt:options.transparent ? `This is an RGBA format image with transparency. ${prompt}. The image has an alpha channel and a transparent background.` : prompt,negative_prompt:'',resolution:Number(options.resolution ?? 1024)}},
      '5': {class_type:'EmptyLatentImage',inputs:{width,height,batch_size:1}},
      '6': {class_type:'KSampler',inputs:{model:['1',0],positive:['4',0],negative:['4',1],latent_image:references.length?['4',2]:['5',0],seed,steps,cfg:1,sampler_name:'euler',scheduler:'simple',denoise:1}},
      '7': {class_type:'VAEDecode',inputs:{samples:['6',0],vae:['3',0]}},
      '8': {class_type:'SaveImage',inputs:{images:['7',0],filename_prefix:'Tony_Qwen21'}}
    };
    if(references.length) {
      graph['4'].inputs.vae=['3',0];
      delete graph['5']; // edit latent follows the resized first reference, as documented by the encoder node
      references.forEach((image,i)=>{
        const id=String(20+i); graph[id]={class_type:'LoadImage',inputs:{image}};
        graph['4'].inputs[`images.image_${i+1}`]=[id,0];
      });
    }
    return graph;
  }
  function readiness(info, model, options={}) {
    if(!MODELS[model]) throw new Error('Unknown image model');
    const klein=Boolean(MODELS[model].textOnly);
    const required=klein ? [...KLEIN_REQUIRED,...(options.use_attached_lora?['LoraLoaderModelOnly']:[])] : REQUIRED;
    const missingNodes=required.filter(name=>!info[name]);
    const find=(node,input,filename)=>(info[node]?.input?.required?.[input]?.[0] ?? []).find(n=>n===filename||n.endsWith('/'+filename));
    const wanted={diffusion:MODELS[model].diffusion,encoder:MODELS[model].encoder??ENCODER,vae:VAE};
    const files={diffusion:find('UNETLoader','unet_name',wanted.diffusion),encoder:find('CLIPLoader','clip_name',wanted.encoder),vae:find('VAELoader','vae_name',wanted.vae)};
    if(klein) {
      Object.assign(wanted,{kleinDiffusion:KLEIN.diffusion,kleinEncoder:KLEIN.encoder,kleinVae:KLEIN.vae});
      Object.assign(files,{kleinDiffusion:find('UNETLoader','unet_name',KLEIN.diffusion),kleinEncoder:find('CLIPLoader','clip_name',KLEIN.encoder),kleinVae:find('VAELoader','vae_name',KLEIN.vae)});
      if(options.use_attached_lora) {wanted.lora=ATTACHED_LORA;files.lora=find('LoraLoaderModelOnly','lora_name',ATTACHED_LORA);}
    }
    return {ready:!missingNodes.length&&Object.values(files).every(Boolean),missingNodes,missingFiles:Object.keys(files).filter(k=>!files[k]),missingFileNames:Object.keys(files).filter(k=>!files[k]).map(k=>wanted[k]),files};
  }
  const api={MODELS,ENCODER,VAE,REQUIRED,KLEIN,KLEIN_REQUIRED,ATTACHED_LORA,dimensions,buildWorkflow,readiness};
  if(typeof module==='object'&&module.exports) module.exports=api;
  else { root.TonyImages=api; root.KendoImages=api; }
})(typeof window==='object'?window:globalThis);
