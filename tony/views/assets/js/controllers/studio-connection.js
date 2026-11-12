/* Shared collapsible connection UI. Provider credentials never go in browser storage. */
window.TonyConnection = {
  async init(onChange) {
    const $ = selector => document.querySelector(selector);
    let status = null, saving = false;
    async function api(route, input) {
      const response = await fetch('/api/kie/' + route, input ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)} : {signal:AbortSignal.timeout(15000)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'เชื่อมต่อไม่สำเร็จ');
      return data;
    }
    function render() {
      const ready = status?.configured && status?.authenticated;
      $('#connection-state').textContent = !status ? 'ยังเชื่อมต่อบริการไม่ได้' : !status.configured ? 'ยังไม่ได้ตั้ง KIE Key · เปิดเมนูเพื่อใส่คีย์' : ready ? 'เชื่อมต่อแล้ว · พร้อมสร้าง' : 'ใส่ลิงก์ / รหัสเพื่อเข้า Studio';
      $('#connection-note').textContent = ready ? 'ตรวจสรุปและยืนยันค่าใช้จ่ายก่อนส่งงาน' : 'ตั้งค่าการเชื่อมต่อก่อนสร้าง';
      $('.draft-badge').textContent = ready ? 'KIE CONNECTED' : 'DESIGN PREVIEW';
      $('#mcp-url').value = status?.mcp_url || '';
      $('#mcp-copy').disabled = !status?.mcp_url;
      $('#kie-key').disabled = !status?.authenticated || saving;
      $('#kie-key-save').disabled = !status?.authenticated || saving;
      $('#kie-key-state').textContent = status?.configured ? 'บันทึกคีย์แล้ว · ใส่คีย์ใหม่เพื่อเปลี่ยนได้' : status?.authenticated ? 'ใส่ KIE API Key แล้วกดบันทึก' : 'เชื่อมต่อ Studio ก่อนบันทึกคีย์';
      $('#connection-form button[type=submit]').disabled = !status?.access_configured;
      onChange(status);
    }
    async function refresh() { try { status = await api('status'); } catch { status = null; } render(); }
    function codeFrom(value) {
      const text=value.trim();
      if (!/^https?:\/\//i.test(text)) return text;
      const url=new URL(text), match=url.pathname.match(/\/mcp\/([^/]+)\/?$/);
      if (!match) throw new Error('ใช้ลิงก์ MCP ที่มี /mcp/ ตามด้วยรหัส');
      return decodeURIComponent(match[1]);
    }
    $('#connection-form').addEventListener('submit', async event => {
      event.preventDefault();
      try { await api('connect',{code:codeFrom($('#access-code').value)}); $('#access-code').value=''; $('#connection-message').textContent='เชื่อมต่อ Studio แล้ว'; await refresh(); }
      catch(e) { $('#connection-message').textContent=e.message; }
    });
    $('#kie-key-form').addEventListener('submit', async event => {
      event.preventDefault(); if(saving) return;
      saving=true;
      const entered=$('#kie-key').value; $('#kie-key').value=''; render();
      try { await api('config',{api_key:entered}); $('#connection-message').textContent='บันทึก KIE Key แล้ว · ใช้ร่วมทั้งภาพ วิดีโอ และ MCP'; await refresh(); }
      catch(e) { $('#connection-message').textContent=e.message; }
      finally { saving=false; render(); }
    });
    $('#mcp-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#mcp-url').value); $('#connection-message').textContent='คัดลอกลิงก์ MCP แล้ว'; }
      catch { $('#mcp-url').select(); $('#connection-message').textContent='เลือกลิงก์แล้ว กรุณาคัดลอก'; }
    });
    await refresh();
    if (!status?.authenticated && status?.access_configured) {
      try {
        const response=await fetch('/api/tony/status',{cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!response.ok) return;
        const pod=await response.json();
        if(pod.mcp_url) { await api('connect',{code:codeFrom(pod.mcp_url)}); await refresh(); }
      } catch {}
    }
  }
};
window.KendoConnection = window.TonyConnection;

