/* Image Studio: server-side KIE key, explicit review before paid submission. */
(async () => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  let MODELS;
  try {
    const response = await fetch('/api/kie/image-models');
    if (!response.ok) throw new Error();
    MODELS = (await response.json()).models;
  } catch {
    $('#model-note').textContent = 'โหลดรายชื่อโมเดลไม่ได้ กรุณารีโหลดหน้า';
    $('#generate').disabled = true; return;
  }
  $('#image-model').replaceChildren(...Object.entries(MODELS).map(([id,m]) => new Option(m.name,id)));
  $('#image-model').disabled = false;
  $('#generate').disabled = false;
  const current = () => MODELS[$('#image-model').value];
  const maximum = () => current().maxImages;
  const INITIAL_SLOTS = 3;
  const MAX_IMAGE_BYTES = () => current().maxBytes;
  const slots = Array(16).fill(null);
  let visibleSlots = INITIAL_SLOTS;

  function error(message = '') {
    $('#upload-error').textContent = message;
    $('#upload-error').hidden = !message;
  }
  function fileAccepted(file) {
    return /\.(jpe?g|png|webp)$/i.test(file.name) && /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= MAX_IMAGE_BYTES();
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
          messages.push(`${file.name}: ใช้ JPG, PNG หรือ WEBP ขนาดไม่เกิน ${MAX_IMAGE_BYTES() / 1024 / 1024} MB`);
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
      renderReferences(); updateSettings();
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
          error(); renderReferences(); updateSettings();
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
  function estimate() {
    const m=current();
    return m.rates[$('#resolution').value] + Math.max(0,slots.filter(Boolean).length-m.freeReferences)*m.referenceRate;
  }
  function updateSettings() {
    const resolution=$('#resolution').value, ratio=$('#ratio').value, m=current();
    $('#summary-resolution').textContent=resolution==='native'?'ตามโมเดล':resolution;
    $('#summary-ratio').textContent=ratio;
    $('#summary-format').textContent=m.formats.length?$('#output-format').value.toUpperCase():'ตามโมเดล';
    $('#preview-format').textContent=`${ratio} · ${$('#summary-resolution').textContent}`;
    const price=estimate(), fx=Number($('#fx-rate').value);
    $('#price').textContent=`$${price.toFixed(4).replace(/0+$/,'').replace(/\.$/,'')}`;
    $('#price-rate').textContent=m.referenceRate ? `ภาพอ้างอิงเพิ่ม $${m.referenceRate} / ภาพ${m.freeReferences?' · ภาพแรกฟรี':''}` : 'รวมภาพอ้างอิง · ต่อหนึ่งงาน';
    $('#price-baht').textContent=Number.isFinite(fx)&&fx>0?`ประมาณ ${(price*fx).toFixed(2)} บาท / ภาพ`:'กรุณาระบุอัตราแลกเปลี่ยน';
  }
  ['ratio','resolution','output-format','fx-rate'].forEach(id => $(`#${id}`).addEventListener('input',updateSettings));
  function updatePromptCount() { $('#prompt-count').textContent = `${$('#prompt').value.length.toLocaleString('en-US')} / ${current().maxPrompt.toLocaleString('en-US')}`; }
  $('#prompt').addEventListener('input', updatePromptCount);
  $('#example').addEventListener('click', () => {
    $('#prompt').value = 'ภาพถ่ายสินค้า ขวดน้ำหอมแก้วใสวางบนหินอ่อนสีครีม แสงอาทิตย์ยามเช้า เงานุ่ม ดอกไม้สีขาวอยู่ด้านหลัง องค์ประกอบเรียบหรู รายละเอียดคมชัด';
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
    if (slots.filter(Boolean).length > maximum()) { error(`มีภาพเกิน ${maximum()} ภาพ กรุณาลบภาพส่วนเกินหรือเปลี่ยนโมเดล`); return; }
    if (prompt.length < current().minPrompt || prompt.length > current().maxPrompt) { error(`Prompt ต้องมี ${current().minPrompt}–${current().maxPrompt} ตัวอักษร`); return; }
    if (slots.filter(Boolean).some(s=>s.file.size>MAX_IMAGE_BYTES())) { error(`โมเดลนี้รับภาพได้ไม่เกิน ${MAX_IMAGE_BYTES()/1024/1024} MB ต่อภาพ`); return; }
    review = { kind:'image', model:$('#image-model').value, prompt, files:slots.filter(Boolean).map(s => s.file), ratio:$('#ratio').value, resolution:$('#resolution').value, request_id:crypto.randomUUID(), confirm_cost:true };
    if(current().formats.length) review.output_format=$('#output-format').value;
    $('#confirm-generate').hidden = !(connection?.configured && connection?.authenticated);
    $('#review-dialog .review-note').textContent = connection?.configured && connection?.authenticated ? `ยืนยันเพื่อส่งงานและใช้เครดิต KIE ประมาณ ${$('#price').textContent} (${ $('#price-baht').textContent})` : 'ดูสรุปได้ ยังไม่มีการส่งงานหรือใช้เครดิต กรุณาตั้งค่าการเชื่อมต่อก่อนสร้าง';
    if (!prompt) { $('#prompt').setCustomValidity('กรุณาอธิบายภาพที่ต้องการ'); $('#prompt').reportValidity(); $('#prompt').focus(); return; }
    $('#prompt').setCustomValidity('');
    $('#review-prompt').textContent = prompt;
    $('#review-images').replaceChildren(...slots.filter(Boolean).map((item, index) => {
      const img = document.createElement('img'); img.src = item.url; img.alt = `ภาพอ้างอิง ${index + 1}`; return img;
    }));
    const details = [
      ['โมเดล', current().name], ['ภาพอ้างอิง', `${slots.filter(Boolean).length} ภาพ`],
      ['สัดส่วน / ความละเอียด', $('#preview-format').textContent],
      ['ค่า API โดยประมาณ', $('#price').textContent]
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
  function applyModel() {
    const m=current(), previous=$('#resolution').value, previousRatio=$('#ratio').value;
    $('#resolution').replaceChildren(...m.resolutions.map(r=>new Option(r==='native'?'ตามโมเดล · เลือก 2K ไม่ได้':r+(r==='2K'?' · แนะนำ':''),r)));
    $('#resolution').value=m.resolutions.includes(previous)?previous:m.resolutions.includes('2K')?'2K':m.resolutions[0];
    $('#ratio').replaceChildren(...m.ratios.map(r=>new Option(r,r)));
    $('#ratio').value=m.ratios.includes(previousRatio)?previousRatio:'1:1';
    $('#output-format').replaceChildren(...m.formats.map(f=>new Option(f.toUpperCase(),f)));
    $('#format-control').hidden=!m.formats.length;
    $('#format-note').textContent=m.formats.length?'':'รูปแบบไฟล์ตามผลลัพธ์จากโมเดล';
    $('#prompt').maxLength=m.maxPrompt;
    $('#model-note').textContent=m.description;
    $('#model-provider').textContent=`${m.provider} · ภาพอ้างอิงสูงสุด ${m.maxImages} ภาพ`;
    $('#model-pricing').href=m.pricing;
    $('#upload-hint').textContent=`JPG, PNG, WEBP · ไม่เกิน ${m.maxBytes/1024/1024} MB ต่อภาพ`;
    visibleSlots=Math.max(Math.min(visibleSlots,m.maxImages),slots.findLastIndex(Boolean)+1,3);
    $('#preview-model-name').textContent=m.name;
    $('.workspace-footer span:first-child').textContent='Tony Studio · สร้างภาพนิ่งผ่าน KIE';
    error(slots.filter(Boolean).length>m.maxImages?`เก็บภาพเดิมไว้ทั้งหมด แต่โมเดลนี้รับได้ ${m.maxImages} ภาพ กรุณาลบส่วนเกินก่อนสร้าง`:'');
    renderReferences();updateSettings();updatePromptCount();
  }
  $('#image-model').addEventListener('change',applyModel);
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
      for (const file of snapshot.files) reference_urls.push((await api('upload?model='+encodeURIComponent(snapshot.model)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':file.type},body:file})).url);
      const {files,...request}=snapshot;
      $('#job-notice').textContent='กำลังส่งงานสร้างภาพนิ่ง…';
      const job = await api('jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,reference_urls})});
      review=null; $('#job-notice').textContent=`ส่งงานแล้ว ${job.task_id} · กำลังรอผลลัพธ์`;
      await loadHistory(); schedulePoll();
    } catch(e) { review=null; $('#job-notice').textContent=e.message+' · หากส่งงานไปแล้ว ให้ตรวจ KIE Logs ก่อนสร้างซ้ำ'; }
    finally { busy=false; $('#confirm-generate').disabled=false; $('#generate').disabled=false; }
  });
  const stateLabel = state => ({waiting:'รอคิว',queuing:'อยู่ในคิว',generating:'กำลังสร้าง',success:'สำเร็จ',fail:'ไม่สำเร็จ'})[state] || state;
  function renderJobs() {
    const imageJobs = jobs.filter(j => j.kind === 'image');
    $('#history-count').textContent=`${imageJobs.length} งาน`;
    $('.library-empty').hidden=imageJobs.length>0;
    $('#history-results').replaceChildren(...imageJobs.map(job => {
      const card=document.createElement('article'); card.className='job-card';
      const title=document.createElement('b'); title.textContent=`${Object.values(MODELS).find(m=>[m.textModel,m.editModel].includes(job.model))?.name || job.model} · ${stateLabel(job.state)}`;
      const detail=document.createElement('small'); detail.textContent=`${job.task_id} · $${job.estimate_usd.toFixed(2)}`;
      card.append(title,detail);
      for(const url of (job.result_urls?.length ? job.result_urls : job.remote_urls || [])) {
        const view=document.createElement('button'); view.textContent='ดูภาพ'; view.type='button';
        view.onclick=()=>{ const img=document.createElement('img'); img.src=url; img.alt='ภาพที่สร้างผ่าน KIE'; $('#preview-canvas').replaceChildren(img); };
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
    const pending=jobs.filter(j=>j.kind==='image' && !['success','fail'].includes(j.state) && Date.now()-Date.parse(j.created_at)<15*60*1000);
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
