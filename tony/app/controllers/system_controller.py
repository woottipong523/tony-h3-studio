"""System status and real-time SSE event stream controller for Tony Studio."""
import json
import queue
import time
from app.models.comfy_model import comfy_bridge, comfy_ready
from app.models.config import VERSION
from app.models.model_registry import download_status
from app.models.runtime_model import (
    comfy_url,
    disk_status,
    mcp_ready,
    mcp_url,
    runtime_status,
)


def build_status_payload() -> dict:
    dl = download_status()
    gen = comfy_bridge.snapshot()
    return {
        "models_ready": dl["models_ready"],
        "comfy_ready": comfy_ready(),
        "download_error": dl["download_error"],
        "downloaded_bytes": dl["downloaded_bytes"],
        "total_bytes": dl["total_bytes"],
        "progress": dl["progress"],
        "active_models": dl["active_models"],
        "version": VERSION,
        "mcp_ready": mcp_ready(),
        "mcp_url": mcp_url(),
        "comfy_url": comfy_url(),
        "runtime": runtime_status(),
        "disk": disk_status(),
        "generation": gen,
    }


def send_status(handler, include_body: bool = True) -> None:
    payload = json.dumps(build_status_payload(), ensure_ascii=False).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    if include_body:
        handler.wfile.write(payload)


def _write_sse(handler, event: str, data: dict) -> None:
    encoded = json.dumps(data, ensure_ascii=False)
    chunk = f"event: {event}\ndata: {encoded}\n\n".encode("utf-8")
    handler.wfile.write(chunk)
    handler.wfile.flush()


def stream_events(handler) -> None:
    """SSE endpoint (/api/tony/events) streaming ComfyUI WS events and system status."""
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    sub_queue = comfy_bridge.subscribe()
    try:
        initial_status = build_status_payload()
        _write_sse(handler, "status", initial_status)
        _write_sse(handler, "generation", initial_status["generation"])

        last_status_check = time.time()
        last_keepalive = time.time()
        last_status_sig = (
            initial_status["models_ready"],
            initial_status["comfy_ready"],
            initial_status["progress"],
            initial_status["download_error"],
            initial_status["mcp_ready"],
            initial_status["disk"]["free_gb"],
        )

        while True:
            try:
                gen_event = sub_queue.get(timeout=1.0)
                _write_sse(handler, "generation", gen_event)
                last_keepalive = time.time()
            except queue.Empty:
                pass

            now = time.time()
            if now - last_status_check >= 2.5:
                last_status_check = now
                current = build_status_payload()
                sig = (
                    current["models_ready"],
                    current["comfy_ready"],
                    current["progress"],
                    current["download_error"],
                    current["mcp_ready"],
                    current["disk"]["free_gb"],
                )
                if sig != last_status_sig:
                    last_status_sig = sig
                    _write_sse(handler, "status", current)
                    last_keepalive = now

            if now - last_keepalive >= 15.0:
                last_keepalive = now
                handler.wfile.write(b": keepalive\n\n")
                handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass
    finally:
        comfy_bridge.unsubscribe(sub_queue)

