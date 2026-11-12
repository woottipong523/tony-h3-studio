"""ComfyUI HTTP helper and real-time WebSocket event bridge for Tony Studio."""
import http.client
import json
import queue
import threading
import time
from app.models.config import COMFY_HOST, COMFY_PORT


def comfy_ready() -> bool:
    connection = http.client.HTTPConnection(COMFY_HOST, COMFY_PORT, timeout=2)
    try:
        connection.request("GET", "/system_stats", headers={"Connection": "close"})
        return connection.getresponse().status == 200
    except (ConnectionError, TimeoutError, OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def fetch_queue_counts() -> dict:
    connection = http.client.HTTPConnection(COMFY_HOST, COMFY_PORT, timeout=3)
    try:
        connection.request("GET", "/queue", headers={"Connection": "close"})
        resp = connection.getresponse()
        if resp.status != 200:
            return {"active": 0, "pending": 0, "ok": False}
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
        running = len(data.get("queue_running") or [])
        pending = len(data.get("queue_pending") or [])
        return {"active": running, "pending": pending, "ok": True}
    except Exception:
        return {"active": 0, "pending": 0, "ok": False}
    finally:
        connection.close()


NODE_PHASE_MAP = {
    "model": ("loading", "กำลังโหลดโมเดลหลัก (UNET)", 5),
    "turbo": ("loading", "กำลังโหลด Turbo LoRA", 8),
    "clip": ("loading", "กำลังโหลด Text Encoder (Qwen3-VL)", 11),
    "vae": ("loading", "กำลังโหลด Video VAE", 13),
    "audioVae": ("loading", "กำลังโหลด Audio VAE", 14),
    "reference": ("conditioning", "กำลังประมวลผล Prompt และไฟล์อ้างอิง", 16),
    "sage": ("sampling", "กำลังตั้งค่า SageAttention", 18),
    "noise": ("sampling", "กำลังเตรียมสัญญาณสุ่ม (Seed)", 18),
    "guider": ("sampling", "กำลังเตรียม Guider", 19),
    "sampler": ("sampling", "กำลังเตรียม Sampler", 19),
    "schedule": ("sampling", "กำลังคำนวณตาราง Step", 20),
    "sample": ("sampling", "กำลังสร้างวิดีโอ (Sampling)", 20),
    "decode": ("decoding", "กำลังถอดรหัสภาพวิดีโอ (VAE Decode)", 92),
    "decodeAudio": ("decoding", "กำลังถอดรหัสเสียง (Audio VAE Decode)", 96),
    "video": ("saving", "กำลังรวมภาพและเสียงเป็นวิดีโอ (24 fps)", 98),
    "save": ("saving", "กำลังบันทึกไฟล์วิดีโอลงเครื่อง", 99),
}


def describe_node(node_id: str) -> tuple[str, str, int]:
    if not node_id:
        return ("running", "กำลังประมวลผล", 10)
    if node_id in NODE_PHASE_MAP:
        return NODE_PHASE_MAP[node_id]
    if node_id.startswith("image"):
        return ("conditioning", "กำลังอ่านภาพอ้างอิง", 15)
    if node_id.startswith("refVideo"):
        return ("conditioning", "กำลังอ่านวิดีโออ้างอิง", 15)
    if node_id.startswith("audio"):
        return ("conditioning", "กำลังอ่านเสียงอ้างอิง", 15)
    return ("running", f"กำลังประมวลผลโหนด {node_id}", 15)


class ComfyWSBridge:
    """Background daemon that listens to ComfyUI /ws and broadcasts real-time state."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue] = set()
        self._running = False
        self._thread: threading.Thread | None = None
        self._state = {
            "ws_connected": False,
            "prompt_id": None,
            "phase": "idle",
            "phase_label": "พร้อมรับงาน",
            "node": None,
            "step": 0,
            "max_steps": 0,
            "percent": 0.0,
            "step_percent": 0.0,
            "started_at": None,
            "elapsed_seconds": 0,
            "eta_seconds": None,
            "queue_active": 0,
            "queue_pending": 0,
            "last_completed_prompt_id": None,
            "last_error": None,
            "updated_at": time.time(),
        }
        self._step_times: list[tuple[int, float]] = []

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(target=self._run_loop, name="tony-comfy-ws", daemon=True)
            self._thread.start()

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._subscribers.discard(q)

    def snapshot(self) -> dict:
        with self._lock:
            snap = dict(self._state)
            if snap["started_at"] and snap["phase"] not in ("idle", "done", "error", "cancelled"):
                snap["elapsed_seconds"] = max(0, int(round(time.time() - snap["started_at"])))
            return snap

    def _broadcast(self, event_type: str, extra: dict | None = None) -> None:
        payload = self.snapshot()
        payload["event"] = event_type
        if extra:
            payload.update(extra)
        with self._lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except queue.Empty:
                    pass

    def _handle_ws_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        msg_type = msg.get("type")
        data = msg.get("data") or {}
        now = time.time()

        if msg_type == "status":
            q_info = fetch_queue_counts()
            with self._lock:
                if q_info["ok"]:
                    self._state["queue_active"] = q_info["active"]
                    self._state["queue_pending"] = q_info["pending"]
                self._state["updated_at"] = now
            self._broadcast("queue")
            return

        if msg_type == "execution_start":
            prompt_id = data.get("prompt_id")
            with self._lock:
                self._step_times = []
                self._state.update(
                    prompt_id=prompt_id,
                    phase="loading",
                    phase_label="กำลังเตรียมโมเดลเข้า VRAM…",
                    node=None,
                    step=0,
                    max_steps=0,
                    percent=2.0,
                    step_percent=0.0,
                    started_at=now,
                    elapsed_seconds=0,
                    eta_seconds=None,
                    last_error=None,
                    updated_at=now,
                )
            self._broadcast("execution_start")
            return

        if msg_type == "executing":
            node = data.get("node")
            prompt_id = data.get("prompt_id") or self._state.get("prompt_id")
            if node is None:
                q_info = fetch_queue_counts()
                with self._lock:
                    started = self._state.get("started_at") or now
                    self._state.update(
                        prompt_id=None,
                        phase="done",
                        phase_label="สร้างวิดีโอเสร็จสมบูรณ์",
                        node=None,
                        percent=100.0,
                        step_percent=100.0,
                        elapsed_seconds=max(0, int(round(now - started))),
                        eta_seconds=0,
                        last_completed_prompt_id=prompt_id,
                        queue_active=q_info["active"] if q_info["ok"] else 0,
                        queue_pending=q_info["pending"] if q_info["ok"] else 0,
                        updated_at=now,
                    )
                self._broadcast("execution_done", {"completed_prompt_id": prompt_id})
                return

            phase, label, base_pct = describe_node(str(node))
            with self._lock:
                if not self._state.get("started_at"):
                    self._state["started_at"] = now
                if prompt_id:
                    self._state["prompt_id"] = prompt_id
                self._state["node"] = str(node)
                self._state["phase"] = phase
                self._state["phase_label"] = label
                if phase != "sampling" or self._state["percent"] < base_pct:
                    self._state["percent"] = float(base_pct)
                self._state["elapsed_seconds"] = max(0, int(round(now - self._state["started_at"])))
                self._state["updated_at"] = now
            self._broadcast("executing")
            return

        if msg_type == "progress":
            val = int(data.get("value") or 0)
            max_val = int(data.get("max") or 0)
            prompt_id = data.get("prompt_id") or self._state.get("prompt_id")
            with self._lock:
                if not self._state.get("started_at"):
                    self._state["started_at"] = now
                if prompt_id:
                    self._state["prompt_id"] = prompt_id
                self._step_times.append((val, now))
                # Keep last 20 step timestamps for responsive moving average
                if len(self._step_times) > 20:
                    self._step_times = self._step_times[-20:]

                eta = None
                if len(self._step_times) >= 2 and max_val > val:
                    first_step, first_t = self._step_times[0]
                    last_step, last_t = self._step_times[-1]
                    delta_steps = last_step - first_step
                    delta_t = last_t - first_t
                    if delta_steps > 0 and delta_t > 0:
                        sec_per_step = delta_t / delta_steps
                        # Add ~8 seconds buffer for VAE decode + video muxing
                        eta = max(1, int(round(sec_per_step * (max_val - val) + 8)))

                step_pct = round(val * 100.0 / max_val, 1) if max_val > 0 else 0.0
                # Sampling covers 20% -> 90% of overall pipeline; step_percent shows 0% -> 100% of steps
                overall_pct = round(20.0 + (step_pct * 0.70), 1) if max_val > 0 else self._state["percent"]
                self._state.update(
                    phase="sampling",
                    phase_label=f"กำลังสร้างวิดีโอ · Step {val}/{max_val}",
                    step=val,
                    max_steps=max_val,
                    step_percent=step_pct,
                    percent=max(self._state["percent"], overall_pct),
                    elapsed_seconds=max(0, int(round(now - self._state["started_at"]))),
                    eta_seconds=eta,
                    updated_at=now,
                )
            self._broadcast("progress")
            return

        if msg_type in ("execution_error", "execution_interrupted"):
            prompt_id = data.get("prompt_id") or self._state.get("prompt_id")
            is_cancel = msg_type == "execution_interrupted"
            err_msg = "ยกเลิกการสร้างวิดีโอแล้ว" if is_cancel else (data.get("exception_message") or "ComfyUI ประมวลผลผิดพลาด")
            with self._lock:
                self._state.update(
                    prompt_id=None,
                    phase="cancelled" if is_cancel else "error",
                    phase_label=err_msg,
                    eta_seconds=None,
                    last_error=None if is_cancel else err_msg,
                    updated_at=now,
                )
            self._broadcast(msg_type, {"failed_prompt_id": prompt_id})

    def _run_loop(self) -> None:
        try:
            import websocket  # websocket-client pre-installed in container
        except ImportError:
            return

        ws_url = f"ws://{COMFY_HOST}:{COMFY_PORT}/ws?clientId=tony-studio-bridge"
        while self._running:
            ws = None
            try:
                ws = websocket.create_connection(ws_url, timeout=5)
                ws.settimeout(2.0)
                q_info = fetch_queue_counts()
                with self._lock:
                    self._state["ws_connected"] = True
                    if q_info["ok"]:
                        self._state["queue_active"] = q_info["active"]
                        self._state["queue_pending"] = q_info["pending"]
                self._broadcast("ws_connected")

                while self._running:
                    try:
                        raw = ws.recv()
                        if not raw:
                            break
                        if isinstance(raw, str):
                            self._handle_ws_message(raw)
                    except websocket.WebSocketTimeoutException:
                        continue
            except Exception:
                with self._lock:
                    was_connected = self._state["ws_connected"]
                    self._state["ws_connected"] = False
                if was_connected:
                    self._broadcast("ws_disconnected")
                time.sleep(2.0)
            finally:
                if ws is not None:
                    try:
                        ws.close()
                    except Exception:
                        pass


comfy_bridge = ComfyWSBridge()

