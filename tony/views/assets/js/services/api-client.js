/* MVC Service Layer: HTTP API & Real-time SSE Streams for Tony Studio. */
'use strict';
(function (root) {
  async function comfy(path, options = {}) {
    const response = await fetch('/api/comfy' + path, options);
    const text = await response.text();
    let result = {};
    try { result = text ? JSON.parse(text) : {}; } catch { result = { raw: text }; }
    if (!response.ok) {
      throw new Error(result.error?.message || result.error || JSON.stringify(result.node_errors || result));
    }
    return result;
  }

  async function fetchStatus() {
    const response = await fetch('/api/tony/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  async function fetchLogs() {
    const response = await fetch('/api/tony/logs', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  async function deleteVideo({ filename, subfolder = '', type = 'output', jobId = null }) {
    const response = await fetch('/api/tony/files/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, subfolder, type, jobId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'ลบไฟล์ไม่สำเร็จ');
    }
    return data;
  }

  async function interruptComfy() {
    const response = await fetch('/api/comfy/interrupt', { method: 'POST' });
    if (!response.ok) throw new Error('ไม่สามารถส่งคำสั่งยกเลิกได้');
    return true;
  }

  function connectEvents({ onStatus, onGeneration, onOpen, onError }) {
    if (typeof EventSource === 'undefined') return null;
    const es = new EventSource('/api/tony/events');
    es.onopen = () => { if (onOpen) onOpen(); };
    es.onerror = err => { if (onError) onError(err); };
    es.addEventListener('status', event => {
      try {
        const data = JSON.parse(event.data);
        if (onStatus) onStatus(data);
      } catch {}
    });
    es.addEventListener('generation', event => {
      try {
        const data = JSON.parse(event.data);
        if (onGeneration) onGeneration(data);
      } catch {}
    });
    return es;
  }

  function connectLogStream({ getOffset, onSnapshot, onAppend, onGpu, onOpen, onError }) {
    if (typeof EventSource === 'undefined') return null;
    const offset = typeof getOffset === 'function' ? (getOffset() || 0) : 0;
    const url = offset > 0 ? `/api/tony/logs/stream?offset=${encodeURIComponent(offset)}` : '/api/tony/logs/stream';
    const es = new EventSource(url);
    es.onopen = () => { if (onOpen) onOpen(); };
    es.onerror = err => { if (onError) onError(err); };
    es.addEventListener('snapshot', event => {
      try {
        const data = JSON.parse(event.data);
        if (onSnapshot) onSnapshot(data);
      } catch {}
    });
    es.addEventListener('append', event => {
      try {
        const data = JSON.parse(event.data);
        if (onAppend) onAppend(data);
      } catch {}
    });
    es.addEventListener('gpu', event => {
      try {
        const data = JSON.parse(event.data);
        if (onGpu) onGpu(data);
      } catch {}
    });
    return es;
  }

  root.TonyApi = {
    comfy,
    fetchStatus,
    fetchLogs,
    deleteVideo,
    interruptComfy,
    connectEvents,
    connectLogStream
  };
})(globalThis);

