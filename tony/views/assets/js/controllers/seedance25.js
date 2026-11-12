/* Seedance Studio: server-side KIE key, explicit review before paid submission. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const MODELS = {
    'seedance-2-5': {name:'Seedance 2.5', images:30, duration:30, prompt:30000, rates:{'480p':.14,'720p':.315,'1080p':.79}},
    'seedance-2': {name:'Seedance 2.0', images:9, duration:15, prompt:20000, rates:{'480p':.095,'720p':.205,'1080p':.51,'4k':1.04}}
  };
  const current = () => MODELS[$('#video-model').value];
  const maximum = () => current().images;
  const INITIAL_SLOTS = 3;
  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const slots = Array(30).fill(null);
  let visibleSlots = INITIAL_SLOTS;

  function error(message = '') {
    $('#upload-error').textContent = message;
    $('#upload-error').hidden = !message;
  }
  function fileAccepted(file) {
    return /\.(jpe?g|png|webp)$/i.test(file.name) && /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= MAX_IMAGE_BYTES;
  }
  function setImage(index, file) {
    if (slots[index]) URL.revokeObjectURL(slots[index].url);
    slots[index] = { file, url: URL.createObjectURL(file) };
  }
  async function readableImage(file) {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }
  let readingFiles = false;
  async function acceptFiles(files, startIndex) {
    if (readingFiles) return;
    readingFiles = true;
    error();
    const messages = [];
    let nextIndex = startIndex;
    try {
      for (const [position, file] of Array.from(files).entries()) {
        if (!fileAccepted(file)) {
          messages.push(`${file.name}: ใช้ JPG, PNG หรือ WEBP ขนาดไม่เกิน 30 MB`);
          continue;
        }
        try { await readableImage(file); }
        catch { messages.push(`${file.name}: เปิดภาพไม่ได้ กรุณาเลือกไฟล์ภาพที่สมบูรณ์`); continue; }
        if (position > 0 || slots[nextIndex]) {
          // A single file replaces the selected slot; additional files fill empty slots.
          if (!(files.length === 1 && position === 0)) {
            nextIndex = slots.findIndex((item, index) => !item && index >= nextIndex);
            if (nextIndex < 0) nextIndex = slots.findIndex(item => !item);
          }
        }
        if (nextIndex < 0 || nextIndex >= maximum()) {
          messages.push(`โมเดลนี้แนบได้สูงสุด ${maximum()} ภาพ`);
          break;
        }
        setImage(nextIndex, file);
        visibleSlots = Math.max(visibleSlots, Math.min(maximum(), nextIndex + 1));
        nextIndex += 1;
      }
      renderReferences();
      error(messages.join(' · '));
    } finally { readingFiles = false; }
  }
  function renderReferences() {
    const grid = $('#reference-grid');
    const nodes = [];
    for (let index = 0; index < visibleSlots; index++) {
      const item = slots[index];
      const card = document.createElement('div');
      card.className = `reference-slot${item ? ' has-image' : ''}`;
      card.dataset.slot = String(index);
      if (item) {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = `ภาพอ้างอิง ${index + 1}: ${item.file.name}`;
        card.append(img);
      }
      const label = document.createElement('label');
      label.className = 'upload-input';
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.multiple = true;
      input.setAttribute('aria-label', `${item ? 'เปลี่ยน' : 'แนบ'}ภาพอ้างอิง ${index + 1}`);
      input.addEventListener('change', event => { void acceptFiles(event.target.files, index); });
      if (!item) {
        const plus = document.createElement('span'); plus.className = 'upload-plus'; plus.textContent = '＋';
        const text = document.createElement('span'); text.textContent = 'แนบภาพ';
        label.append(plus, text);
      }
      label.append(input);
      const number = document.createElement('span');
      number.className = 'slot-number'; number.textContent = String(index + 1).padStart(2, '0');
      card.append(label, number);
      if (item) {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'remove-image'; remove.textContent = '×';
        remove.setAttribute('aria-label', `ลบภาพอ้างอิง ${index + 1}`);
        remove.addEventListener('click', () => {
          URL.revokeObjectURL(slots[index].url);
          slots[index] = null;
          error(); renderReferences();
          grid.children[index].querySelector('input').focus();
        });
        const name = document.createElement('span');
        name.className = 'file-name'; name.textContent = item.file.name; name.title = item.file.name;
        card.append(remove, name);
      }
      card.addEventListener('dragover', event => { event.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', event => {
        event.preventDefault(); card.classList.remove('drag-over');
        void acceptFiles(event.dataTransfer.files, index);
      });
      nodes.push(card);
    }
    grid.replaceChildren(...nodes);
    const count = slots.filter(Boolean).length;
    $('#image-count').textContent = `${count} / ${maximum()}`;
    $('#summary-images').textContent = `${count} ภาพ`;
    $('#slot-count').textContent = `${visibleSlots} / ${maximum()} ช่อง`;
    $('#add-references').disabled = visibleSlots >= maximum();
    $('#add-references').firstChild.textContent = visibleSlots >= maximum() ? `ครบ ${maximum()} ช่องแล้ว ` : '＋ เพิ่มช่องแนบภาพ ';
  }
  $('#add-references').addEventListener('click', () => {
    if (visibleSlots >= maximum()) return;
    const firstNewIndex = visibleSlots;
    visibleSlots = Math.min(maximum(), visibleSlots + 1);
    renderReferences();
    $('#reference-grid').children[firstNewIndex].querySelector('input').focus({ preventScroll: true });
  });
  function updateSettings() {
    const seconds = Number($('#duration').value);
    const ratio = $('#ratio').value;
    const resolution = $('#resolution').value;
    $('#duration-value').textContent = `${seconds} วินาที`;
    $('#duration').setAttribute('aria-valuetext', `${seconds} วินาที`);
    $('#summary-duration').textContent = `${seconds} วินาที`;
    $('#summary-ratio').textContent = ratio;
    $('#summary-audio').textContent = $('#generate-audio').checked ? 'เปิด' : 'ปิด';
    $('#preview-format').textContent = `${ratio} · ${resolution}`;
    $('#price').textContent = `$${(seconds * current().rates[resolution]).toFixed(2)}`;
    const fx = Number($('#fx-rate').value);
    const rate = current().rates[resolution];
    $('#price-rate').textContent = `$${rate.toFixed(3)} / วินาที · ${Number.isFinite(fx) && fx > 0 ? (rate * fx).toFixed(2) : '—'} บาท/วินาที`;
    $('#price-baht').textContent = Number.isFinite(fx) && fx > 0 ? `ประมาณ ${(seconds * rate * fx).toFixed(2)} บาท / คลิป` : 'กรุณาระบุอัตราแลกเปลี่ยน';
  }
  ['duration', 'ratio', 'resolution', 'generate-audio', 'fx-rate'].forEach(id => {
    $(`#${id}`).addEventListener('input', updateSettings);
  });
  function updatePromptCount() { $('#prompt-count').textContent = `${$('#prompt').value.length.toLocaleString('en-US')} / ${current().prompt.toLocaleString('en-US')}`; }
  $('#prompt').addEventListener('input', updatePromptCount);
  $('#example').addEventListener('click', () => {
    $('#prompt').value = 'สร้างฉากภาพยนตร์จากตัวละครและสถานที่ในภาพอ้างอิง ตัวละครเดินผ่านร้านกาแฟในแสงอาทิตย์ยามเย็น กล้องค่อย ๆ เคลื่อนเข้าใกล้ ใบหน้าและเสื้อผ้าสม่ำเสมอ มีเสียงบรรยากาศถนนเบา ๆ';
    updatePromptCount(); $('#prompt').focus();
  });
  function setTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    $('#theme span').textContent = dark ? 'โหมดสว่าง' : 'โหมดมืด';
    $('#theme').setAttribute('aria-pressed', String(dark));
    document.querySelector('meta[name="theme-color"]').content = dark ? '#101014' : '#faf9fb';
    try { localStorage.setItem('tony-theme', dark ? 'dark' : 'light'); } catch {}
  }
  let dark = false;
  try { dark = (localStorage.getItem('tony-theme') || localStorage.getItem('kendo-theme')) === 'dark'; } catch {}
  setTheme(dark);
  $('#theme').addEventListener('click', () => setTheme(!document.documentElement.classList.contains('dark')));
  $('#generate').addEventListener('click', () => {
    const prompt = $('#prompt').value.trim();
    if (slots.filter(Boolean).length > maximum()) { error(`มีภาพเกิน ${maximum()} ภาพ กรุณาลบภาพส่วนเกินหรือเลือก Seedance 2.5`); return; }
    if (prompt.length > current().prompt) { error(`Prompt ยาวเกิน ${current().prompt} ตัวอักษร`); return; }
    review = { kind:'video', model:$('#video-model').value, prompt, files:slots.filter(Boolean).map(s => s.file), ratio:$('#ratio').value, resolution:$('#resolution').value, duration:Number($('#duration').value), generate_audio:$('#generate-audio').checked, request_id:crypto.randomUUID(), confirm_cost:true };
    $('#confirm-generate').hidden = !(connection?.configured && connection?.authenticated);
    $('#review-dialog .review-note').textContent = connection?.configured && connection?.authenticated ? `ยืนยันเพื่อส่งงานและใช้เครดิต KIE ประมาณ ${$('#price').textContent} (${ $('#price-baht').textContent})` : 'ดูสรุปได้ ยังไม่มีการส่งงานหรือใช้เครดิต กรุณาตั้งค่าการเชื่อมต่อก่อนสร้าง';
    if (!prompt) { $('#prompt').setCustomValidity('กรุณาอธิบายวิดีโอที่ต้องการ'); $('#prompt').reportValidity(); $('#prompt').focus(); return; }
    $('#prompt').setCustomValidity('');
    $('#review-prompt').textContent = prompt;
    $('#review-images').replaceChildren(...slots.filter(Boolean).map((item, index) => {
      const img = document.createElement('img'); img.src = item.url; img.alt = `ภาพอ้างอิง ${index + 1}`; return img;
    }));
    const details = [
      ['โมเดล', current().name], ['ภาพอ้างอิง', `${slots.filter(Boolean).length} ภาพ`],
      ['ความยาว', $('#duration-value').textContent], ['สัดส่วน / ความละเอียด', $('#preview-format').textContent],
      ['เสียงประกอบ', $('#summary-audio').textContent], ['ค่า API โดยประมาณ', $('#price').textContent]
    ];
    $('#review-details').replaceChildren(...details.flatMap(([name, value]) => {
      const dt = document.createElement('dt'); dt.textContent = name;
      const dd = document.createElement('dd'); dd.textContent = value;
      return [dt, dd];
    }));
    $('#review-dialog').showModal();
  });
  $('#prompt').addEventListener('input', () => $('#prompt').setCustomValidity(''));

  let connection = null, review = null, busy = false, jobs = [], pollTimer;
  const welcomeMarkup = $('#preview-canvas').innerHTML;
  function applyModel() {
    const model = current(), previous = $('#resolution').value;
    $('#resolution').replaceChildren(...Object.keys(model.rates).map(value => new Option(value === '4k' ? '4K · HEVC' : value, value)));
    $('#resolution').value = model.rates[previous] ? previous : '720p';
    $('#duration').max = model.duration;
    $('#duration').value = Math.min(Number($('#duration').value), model.duration);
    $('.duration-control small span:last-child').textContent = `${model.duration} วินาที`;
    $('#prompt').maxLength = model.prompt;
    $('#product-name').textContent = model.name;
    $('#model-card b').textContent = model.name;
    $('.model-mark span').textContent = model.name.split(' ').at(-1);
    $('#model-note').textContent = `สูงสุด ${model.duration} วินาที · ${model.images} ภาพอ้างอิง · ข้อความ/ภาพคิดตามความยาวผลลัพธ์`;
    visibleSlots = Math.max(3, Math.min(visibleSlots, model.images), slots.findLastIndex(Boolean) + 1);
    if (!jobs.some(job => job.result_urls?.length)) {
      $('#preview-canvas').innerHTML = welcomeMarkup;
      $('.welcome-badge').textContent = `TONY STUDIO / ${model.name.toUpperCase()}`;
      $('.story-main small').textContent = model.name.toUpperCase();
      $('.welcome p').textContent = `เริ่มจากภาพที่คุณชอบ แล้วให้ ${model.name} ช่วยเล่าเรื่องของคุณ`;
    }
    $('.preview-footer span:last-child').textContent = model.name;
    $('.workspace-footer span:first-child').textContent = `Tony-Seedance 2.5+Qwen · ${model.name}`;
    error(slots.filter(Boolean).length > model.images ? `เก็บภาพเดิมไว้ทั้งหมด แต่โมเดลนี้ส่งได้ ${model.images} ภาพ กรุณาลบส่วนเกินหรือเลือก 2.5` : '');
    renderReferences(); updateSettings(); updatePromptCount();
  }
  $('#video-model').addEventListener('change', applyModel);
  async function api(route, init={}) {
    const response = await fetch('/api/kie/' + route, {...init, signal:AbortSignal.timeout(120000)});
    let data; try { data = await response.json(); } catch { throw new Error('ยังไม่มีบริการ KIE ที่หน้านี้'); }
    if (!response.ok) throw new Error(data.error || `KIE ${response.status}`);
    return data;
  }
  function updateConnection(status) {
    connection=status;
    if(connection?.configured && connection?.authenticated) void loadHistory();
  }
  $('#confirm-generate').addEventListener('click', async () => {
    if (busy || !review) return;
    busy=true; $('#confirm-generate').disabled=true; $('#generate').disabled=true;
    $('#review-dialog').close(); $('#job-notice').textContent='กำลังส่งภาพอ้างอิง…';
    try {
      const snapshot = review, reference_urls=[];
      for (const file of snapshot.files) reference_urls.push((await api('upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':file.type},body:file})).url);
      const {files,...request}=snapshot;
      $('#job-notice').textContent='กำลังส่งงานสร้างวิดีโอ…';
      const job = await api('jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,reference_urls})});
      review=null; $('#job-notice').textContent=`ส่งงานแล้ว ${job.task_id} · กำลังรอผลลัพธ์`;
      await loadHistory(); schedulePoll();
    } catch(e) { review=null; $('#job-notice').textContent=e.message+' · หากส่งงานไปแล้ว ให้ตรวจ KIE Logs ก่อนสร้างซ้ำ'; }
    finally { busy=false; $('#confirm-generate').disabled=false; $('#generate').disabled=false; }
  });
  const stateLabel = state => ({waiting:'รอคิว',queuing:'อยู่ในคิว',generating:'กำลังสร้าง',success:'สำเร็จ',fail:'ไม่สำเร็จ'})[state] || state;
  function renderJobs() {
    const videoJobs = jobs.filter(j => j.kind === 'video');
    $('#history-count').textContent=`${videoJobs.length} งาน`;
    $('.library-empty').hidden=videoJobs.length>0;
    $('#history-results').replaceChildren(...videoJobs.map(job => {
      const card=document.createElement('article'); card.className='job-card';
      const title=document.createElement('b'); title.textContent=`${job.model.includes('2-5')?'Seedance 2.5':'Seedance 2.0'} · ${stateLabel(job.state)}`;
      const detail=document.createElement('small'); detail.textContent=`${job.task_id} · $${job.estimate_usd.toFixed(2)}`;
      card.append(title,detail);
      for(const url of (job.result_urls?.length ? job.result_urls : job.remote_urls || [])) {
        const view=document.createElement('button'); view.textContent='ดูวิดีโอ'; view.type='button';
        view.onclick=()=>{ const video=document.createElement('video'); video.src=url; video.controls=true; video.playsInline=true; $('#preview-canvas').replaceChildren(video); };
        const download=document.createElement('a'); download.href=url; download.textContent='ดาวน์โหลด ↗'; download.download=''; download.rel='noopener'; download.target='_blank'; card.append(view,download);
      }
      if(job.error || job.download_error) { const note=document.createElement('p'); note.textContent=job.error || job.download_error; card.append(note); }
      return card;
    }));
  }
  async function loadHistory() {
    try { jobs=(await api('jobs')).jobs; renderJobs(); schedulePoll(); }
    catch(e) { $('#job-notice').textContent=e.message; }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    const pending=jobs.filter(j=>j.kind==='video' && !['success','fail'].includes(j.state) && Date.now()-Date.parse(j.created_at)<15*60*1000);
    if(!pending.length) return;
    pollTimer=setTimeout(async()=>{
      try { for(const job of pending) { const updated=await api('jobs/'+encodeURIComponent(job.task_id)); jobs=jobs.map(j=>j.task_id===updated.task_id?updated:j); } renderJobs(); }
      catch(e) { $('#job-notice').textContent=e.message; }
      schedulePoll();
    },4000);
  }
  window.addEventListener('beforeunload', () => slots.filter(Boolean).forEach(item => URL.revokeObjectURL(item.url)));
  applyModel(); void window.TonyConnection.init(updateConnection);
})();
