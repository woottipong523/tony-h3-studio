"""Log file reading and real-time tailing model for Tony Studio."""
import os
from app.models.config import COMFY_LOG_FILE, GPU_LOG_FILE, MAX_LOG_BYTES


def read_gpu_log(max_bytes: int = 8192) -> str:
    if not GPU_LOG_FILE:
        return ""
    try:
        with open(GPU_LOG_FILE, "rb") as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(max(0, size - max_bytes))
            return stream.read(max_bytes).decode("utf-8", errors="replace")
    except OSError:
        return ""


def read_log_snapshot() -> dict:
    text = ""
    available = False
    offset = 0
    if COMFY_LOG_FILE:
        try:
            with open(COMFY_LOG_FILE, "rb") as stream:
                stream.seek(0, os.SEEK_END)
                size = stream.tell()
                start = max(0, size - MAX_LOG_BYTES)
                stream.seek(start)
                data = stream.read(MAX_LOG_BYTES)
                offset = stream.tell()
            text = data.decode("utf-8", errors="replace")
            if size > MAX_LOG_BYTES:
                text = "… แสดงเฉพาะ Log ล่าสุด …\n" + text
            available = True
        except OSError:
            pass
    return {
        "available": available,
        "text": text,
        "gpu_text": read_gpu_log(),
        "offset": offset,
    }


def read_log_delta(last_offset: int) -> tuple[str, int, bool]:
    """Read new bytes appended to COMFY_LOG_FILE since last_offset.

    Returns (new_text, new_offset, reset_flag).
    """
    if not COMFY_LOG_FILE or not os.path.isfile(COMFY_LOG_FILE):
        return "", 0, False
    try:
        with open(COMFY_LOG_FILE, "rb") as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            if last_offset < 0 or last_offset > size:
                # File was truncated or newly requested
                start = max(0, size - MAX_LOG_BYTES)
                stream.seek(start)
                chunk = stream.read(MAX_LOG_BYTES).decode("utf-8", errors="replace")
                if size > MAX_LOG_BYTES:
                    chunk = "… แสดงเฉพาะ Log ล่าสุด …\n" + chunk
                return chunk, size, True
            if size == last_offset:
                return "", size, False
            read_len = min(size - last_offset, MAX_LOG_BYTES)
            stream.seek(size - read_len)
            chunk = stream.read(read_len).decode("utf-8", errors="replace")
            return chunk, size, False
    except OSError:
        return "", last_offset, False

