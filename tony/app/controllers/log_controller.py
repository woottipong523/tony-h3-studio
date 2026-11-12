"""Log snapshot and real-time SSE log tailing controller for Tony Studio."""
import json
import time
from urllib.parse import parse_qs, urlsplit
from app.models.log_model import read_gpu_log, read_log_delta, read_log_snapshot


def send_logs(handler) -> None:
    snap = read_log_snapshot()
    payload = json.dumps(snap, ensure_ascii=False).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def _write_sse(handler, event: str, data: dict) -> None:
    encoded = json.dumps(data, ensure_ascii=False)
    handler.wfile.write(f"event: {event}\ndata: {encoded}\n\n".encode("utf-8"))
    handler.wfile.flush()


def stream_logs(handler) -> None:
    """SSE endpoint (/api/tony/logs/stream) tailing ComfyUI log in real time."""
    query = parse_qs(urlsplit(handler.path).query)
    requested_offset = None
    if "offset" in query:
        try:
            requested_offset = int(query["offset"][0])
        except (ValueError, IndexError):
            requested_offset = None

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    try:
        if requested_offset is not None and requested_offset > 0:
            offset = requested_offset
            chunk, offset, reset = read_log_delta(offset)
            if chunk:
                _write_sse(
                    handler,
                    "snapshot" if reset else "append",
                    {"available": True, "text": chunk, "offset": offset, "gpu_text": read_gpu_log()},
                )
        else:
            snap = read_log_snapshot()
            offset = snap["offset"]
            _write_sse(handler, "snapshot", snap)

        last_keepalive = time.time()
        last_gpu_check = time.time()
        last_gpu_text = read_gpu_log()

        while True:
            time.sleep(0.5)
            chunk, new_offset, reset = read_log_delta(offset)
            now = time.time()

            if chunk:
                offset = new_offset
                _write_sse(
                    handler,
                    "snapshot" if reset else "append",
                    {"available": True, "text": chunk, "offset": offset},
                )
                last_keepalive = now

            if now - last_gpu_check >= 4.0:
                last_gpu_check = now
                gpu_now = read_gpu_log()
                if gpu_now != last_gpu_text:
                    last_gpu_text = gpu_now
                    _write_sse(handler, "gpu", {"gpu_text": gpu_now})
                    last_keepalive = now

            if now - last_keepalive >= 15.0:
                last_keepalive = now
                handler.wfile.write(b": keepalive\n\n")
                handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass

