const $ = (selector) => document.querySelector(selector);
const refs = [null];
const imageNodeIds = ["153", "156", "158", "159", "160"];
let submitting = false;
let systemReady = false;
const activeJobs = new Map();

const resolutionOutputs = {
  "0.4": [864, 480],
  "0.7": [1152, 640],
  "0.9": [1280, 736],
  "1": [1376, 768],
  "1.2": [1504, 832],
  "2": [1920, 1088]
};

function outputSize(megapixels, ratio) {
  const [wideWidth, wideHeight] = resolutionOutputs[String(megapixels)] || resolutionOutputs["0.4"];
  if (ratio === "9:16") return `${wideHeight} × ${wideWidth}`;
  if (ratio === "1:1") {
    const side = Math.round(Math.sqrt(Number(megapixels) * 1000000) / 32) * 32;
    return `${side} × ${side}`;
  }
  return `${wideWidth} × ${wideHeight}`;
}

function updateResolutionLabels() {
  const ratio = $("#ratio").value;
  const quality = $("#quality");
  const names = { "0.4": "Draft", "0.7": "Balanced" };
  Array.from(quality.options).forEach(option => {
    const mp = option.value;
    option.textContent = `${names[mp] ? `${names[mp]} · ` : ""}${Number(mp).toFixed(1)} MP · ${outputSize(mp, ratio)}`;
  });
  const mp = quality.value;
  $("#meta-resolution").textContent = `${Number(mp).toFixed(1)} MP · ${outputSize(mp, ratio)}`;
}

function comfyBase() {
  return "/api/comfy";
}

function node(class_type, title, inputs) { return { inputs, class_type, _meta: { title } }; }
function buildWorkflow({ prompt, ratio, megapixels, duration, steps, images }) {
  const aspect = { "16:9": "16:9 (Widescreen)", "9:16": "9:16 (Portrait Widescreen)", "1:1": "1:1 (Square)" }[ratio];
  const w = {
    "92":node("SaveVideo","Save Video",{filename_prefix:"video/Tony_Ai_H3",format:"auto",codec:"auto",video:["130",0]}),
    "115":node("ResolutionSelector","Resolution Selector (Size)",{aspect_ratio:aspect,megapixels,multiple:32}),
    "119":node("VAELoader","Load VAE",{vae_name:"minimax_h3_video_vae_fp16.safetensors"}),
    "120":node("VAELoader","Load VAE",{vae_name:"minimax_h3_audio_vae_fp32.safetensors"}),
    "121":node("VAEDecodeAudio","VAE Decode Audio",{samples:["125",0],vae:["120",0]}),
    "122":node("VAEDecode","VAE Decode",{samples:["125",0],vae:["119",0]}),
    "123":node("KSamplerSelect","KSamplerSelect",{sampler_name:"res_multistep"}),
    "124":node("BasicScheduler","BasicScheduler",{scheduler:"simple",steps:["142",0],denoise:1,model:["127",0]}),
    "125":node("SamplerCustomAdvanced","SamplerCustomAdvanced",{noise:["129",0],guider:["126",0],sampler:["123",0],sigmas:["124",0],latent_image:["136",1]}),
    "126":node("BasicGuider","Basic Guider",{model:["141",0],conditioning:["136",0]}),
    "127":node("UNETLoader","Load Diffusion Model",{unet_name:"minimax_h3_fl2va_pruned_int8_convrot.safetensors",weight_dtype:"default"}),
    "128":node("CLIPLoader","Load CLIP",{clip_name:"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",type:"minimax",device:"default"}),
    "129":node("RandomNoise","RandomNoise",{noise_seed:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER)}),
    "130":node("CreateVideo","Create Video",{fps:24,bit_depth:8,images:["122",0],audio:["121",0]}),
    "131":node("ComfyMathExpression","Math Expression",{expression:"max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17","values.a":["132",0]}),
    "132":node("PrimitiveFloat","Float (Duration)",{value:duration}),
    "136":node("MiniMaxH3ReferenceToVideo","MiniMax H3 Reference to Video",{prompt:["138",0],width:["115",0],height:["115",1],length:["131",1],ref_image_size:"match",clip:["128",0],vae:["119",0],audio_vae:["120",0]}),
    "138":node("PrimitiveStringMultiline","Input Text (Prompt)",{value:prompt}),
    "141":node("ComfySwitchNode","If/Else Switch (model)",{switch:["146",0],on_false:["127",0],on_true:["145",0]}),
    "142":node("ComfySwitchNode","If/Else Switch (Steps)",{switch:["146",0],on_false:["143",0],on_true:["144",0]}),
    "143":node("PrimitiveInt","Int (Full)",{value:steps}),
    "144":node("PrimitiveInt","Int (Lightning LoRA)",{value:4}),
    "145":node("LoraLoaderModelOnly","Load LoRA",{lora_name:"minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors",strength_model:1,model:["127",0]}),
    "146":node("PrimitiveBoolean","Boolean (Enable Lightning LoRA)",{value:false})
  };
  images.forEach((name,index)=>{const id=imageNodeIds[index];w[id]=node("LoadImage","Load Image",{image:name});w["136"].inputs[`ref_images.ref_image_${index}`]=[id,0]});
  return w;
}

function renderRefs() {
  const grid = $("#reference-grid"); grid.innerHTML = "";
  refs.forEach((item,index)=>{
    const card=document.createElement("label");card.className="upload";
    card.innerHTML=item?`<img src="${item.preview}" alt="ภาพอ้างอิง ${index+1}"><button class="remove" type="button" aria-label="ลบภาพ">×</button><input type="file" accept="image/png,image/jpeg,image/webp">`:`<span class="placeholder"><strong>＋</strong><b>${index===0?"อัปโหลดภาพหลัก":"ภาพเพิ่มเติม"}</b><small>JPG · PNG · WEBP</small></span><input type="file" accept="image/png,image/jpeg,image/webp">`;
    card.querySelector("input").addEventListener("change",event=>{const file=event.target.files[0];if(!file)return;if(refs[index])URL.revokeObjectURL(refs[index].preview);refs[index]={file,preview:URL.createObjectURL(file)};renderRefs()});
    card.querySelector(".remove")?.addEventListener("click",event=>{event.preventDefault();URL.revokeObjectURL(refs[index].preview);refs.splice(index,1);if(!refs.length)refs.push(null);renderRefs()});grid.append(card)
  });
  if(refs.length<5){const add=document.createElement("button");add.className="add-upload";add.type="button";add.innerHTML="<strong>＋</strong><b>เพิ่มภาพอ้างอิง</b><small>สูงสุด 5 ภาพ</small>";add.onclick=()=>{refs.push(null);renderRefs()};grid.append(add)}
  $("#file-count").textContent=`${refs.filter(Boolean).length} / 5 FILES`;
}

function setStatus(type,text,message){const status=$("#status");status.className=`status ${type}`;status.innerHTML=`<i></i>${text}`;$("#activity-state").textContent=message;$("#progress").classList.toggle("active",type==="running");}
function updateGenerateAvailability(){$("#generate").disabled=submitting||!systemReady}
async function refreshSystemStatus(){
  try{
    const response=await fetch("/api/tony/status",{cache:"no-store"});
    if(!response.ok)throw new Error("status unavailable");
    const state=await response.json();
    systemReady=Boolean(state.models_ready&&state.comfy_ready);
    updateGenerateAvailability();
    if(activeJobs.size||submitting)return;
    if(state.download_error){setStatus("error","DOWNLOAD ERROR","ดาวน์โหลดโมเดลไม่สำเร็จ");$("#notice").textContent="การดาวน์โหลดสะดุด กรุณา Restart Pod เพื่อดาวน์โหลดต่อ";return}
    if(!state.models_ready){const progress=Number(state.progress||0).toFixed(1);setStatus("running","PREPARING",`กำลังเตรียมโมเดล ${progress}%`);$("#notice").textContent=`หน้าเว็บพร้อมแล้ว · กำลังดาวน์โหลดโมเดล ${progress}% · ปุ่มสร้างจะเปิดอัตโนมัติเมื่อพร้อม`;return}
    if(!state.comfy_ready){setStatus("running","STARTING","กำลังเปิด ComfyUI");$("#notice").textContent="โมเดลพร้อมแล้ว · กำลังเริ่มระบบประมวลผล";return}
    setStatus("done","READY","พร้อมสร้างวิดีโอ");$("#notice").textContent="ระบบและโมเดลพร้อมใช้งานแล้ว";
  }catch(_error){systemReady=false;updateGenerateAvailability();if(!activeJobs.size&&!submitting){setStatus("error","OFFLINE","กำลังเชื่อมต่อระบบ");$("#notice").textContent="หน้าเว็บเปิดแล้ว แต่ระบบภายในยังไม่พร้อม"}}
}
function findVideo(value){if(!value||typeof value!=="object")return null;if(Array.isArray(value)){for(const item of value){const found=findVideo(item);if(found)return found}return null}if(typeof value.filename==="string"&&/\.(mp4|webm|mov|mkv|gif)$/i.test(value.filename))return value;for(const item of Object.values(value)){const found=findVideo(item);if(found)return found}return null}
function viewUrl(file){const q=new URLSearchParams({filename:file.filename,subfolder:file.subfolder||"",type:file.type||"output"});return `${comfyBase()}/view?${q}`}
function saveHistory(item){const items=JSON.parse(localStorage.getItem("tony-ai-pod-history")||"[]");const next=[item,...items.filter(x=>x.id!==item.id)].slice(0,20);localStorage.setItem("tony-ai-pod-history",JSON.stringify(next));renderHistory()}
function renderHistory(){const items=JSON.parse(localStorage.getItem("tony-ai-pod-history")||"[]");$("#history-count").textContent=`${items.length} ผลงาน`;const content=$("#history-content");if(!items.length)return;content.className="history-grid";content.innerHTML=items.map(item=>`<article class="history-card"><video src="${item.url}" controls preload="metadata"></video><div><small>${new Date(item.createdAt).toLocaleString("th-TH")}</small><b>${item.ratio} · MiniMax H3</b><p>${item.prompt.replace(/[<>]/g,"")}</p><a href="${item.url}" download>↓ ดาวน์โหลด</a></div></article>`).join("")}
async function waitForJob(id,meta){while(true){await new Promise(r=>setTimeout(r,3000));const response=await fetch(`${comfyBase()}/history/${encodeURIComponent(id)}`,{cache:"no-store"});if(!response.ok)throw new Error("ตรวจสอบสถานะไม่สำเร็จ");const history=await response.json();const entry=history[id];if(!entry)continue;const file=findVideo(entry.outputs);if(file){const url=viewUrl(file);showVideo(url);saveHistory({id,url,createdAt:new Date().toISOString(),...meta});return}if(entry.status?.status_str==="error"||entry.status?.completed===false)throw new Error("ComfyUI ประมวลผลไม่สำเร็จ")}}
function showVideo(url){const preview=$("#preview");preview.querySelector("video")?.remove();const video=document.createElement("video");video.src=url;video.controls=true;video.playsInline=true;preview.append(video);$("#download").href=url;$("#download").classList.remove("disabled")}

function updateQueueStatus(){const count=activeJobs.size;if(count){setStatus("running","RUNNING",`${count} งานกำลังรอหรือประมวลผล`);$("#notice").textContent=`ส่งเข้าคิวแล้ว ${count} งาน · สามารถตั้งค่างานถัดไปและกดสร้างต่อได้เลย`}else{setStatus("done","DONE","งานในคิวเสร็จทั้งหมดแล้ว");$("#notice").textContent="งานในคิวเสร็จทั้งหมดแล้ว"}}
async function monitorJob(id,meta){try{await waitForJob(id,meta);activeJobs.delete(id);updateQueueStatus()}catch(error){activeJobs.delete(id);if(activeJobs.size)updateQueueStatus();else setStatus("error","ERROR","งานล่าสุดประมวลผลไม่สำเร็จ");$("#notice").textContent=error.message||"ComfyUI ประมวลผลไม่สำเร็จ"}}
async function generate(){if(submitting||!systemReady)return;const files=refs.filter(Boolean).map(x=>x.file);const prompt=$("#prompt").value.trim();if(!files.length)return $("#notice").textContent="กรุณาแนบภาพอ้างอิงอย่างน้อย 1 ภาพ";if(!prompt)return $("#notice").textContent="กรุณากรอกคำอธิบายการเคลื่อนไหว";submitting=true;updateGenerateAvailability();$("#generate span").textContent="กำลังส่งเข้าคิว...";setStatus("running","UPLOADING","กำลังอัปโหลดภาพ");try{const names=[];for(let i=0;i<files.length;i++){const form=new FormData();form.append("image",files[i],`${Date.now()}-${i+1}-${files[i].name.replace(/[^a-zA-Z0-9._-]/g,"_")}`);form.append("subfolder","tony-ai");form.append("type","input");form.append("overwrite","true");const response=await fetch(`${comfyBase()}/upload/image`,{method:"POST",body:form});if(!response.ok)throw new Error("อัปโหลดภาพไม่สำเร็จ");const result=await response.json();names.push(result.subfolder?`${result.subfolder}/${result.name}`:result.name)}const ratio=$("#ratio").value;const workflow=buildWorkflow({prompt,ratio,megapixels:Number($("#quality").value),duration:Number($("#duration").value),steps:Number($("#steps").value),images:names});const response=await fetch(`${comfyBase()}/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:workflow,client_id:crypto.randomUUID()})});const result=await response.json();if(!response.ok||!result.prompt_id)throw new Error(result.error?.message||"ส่ง Workflow ไม่สำเร็จ");activeJobs.set(result.prompt_id,{prompt,ratio});updateQueueStatus();void monitorJob(result.prompt_id,{prompt,ratio})}catch(error){if(activeJobs.size)updateQueueStatus();else setStatus("error","ERROR","ส่งงานเข้าคิวไม่สำเร็จ");$("#notice").textContent=error.message||"เชื่อมต่อ ComfyUI ไม่สำเร็จ"}finally{submitting=false;updateGenerateAvailability();$("#generate span").textContent="สร้างวิดีโอ"}}

$("#prompt").addEventListener("input",event=>{const words=Array.from(new Intl.Segmenter("th",{granularity:"word"}).segment(event.target.value)).filter(x=>x.isWordLike).length;$("#word-count").textContent=`${words.toLocaleString("th-TH")} / 5,000 คำ`;if(words>5000)event.target.value=event.target.value.slice(0,-1)});
$("#ratio").addEventListener("change",event=>{$("#preview").className=`preview ratio-${event.target.value.replace(":","-")}`;$("#meta-ratio").textContent=event.target.value;updateResolutionLabels()});
$("#quality").addEventListener("change",updateResolutionLabels);
$("#duration").addEventListener("input",event=>$("#duration-value").textContent=`${Number(event.target.value).toLocaleString("th-TH",{maximumFractionDigits:1})} วินาที`);
$("#steps").addEventListener("input",event=>{$("#meta-steps").textContent=Math.min(50,Math.max(1,Number(event.target.value)||1))});
$("#generate").addEventListener("click",generate);updateResolutionLabels();renderRefs();renderHistory();updateGenerateAvailability();void refreshSystemStatus();setInterval(refreshSystemStatus,5000);
