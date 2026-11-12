"""File management and safe deletion of generated videos for Tony Studio."""
import http.client
import json
import os
import re
from pathlib import Path
from app.models.config import COMFY_HOST, COMFY_OUTPUT_DIR, COMFY_PORT

VIDEO_EXT_RE = re.compile(r"\.(mp4|webm|mov|mkv)$", re.IGNORECASE)


def _delete_comfy_history_item(job_id: str) -> bool:
    if not job_id or not re.match(r"^[\w-]{1,180}$", str(job_id)):
        return False
    conn = http.client.HTTPConnection(COMFY_HOST, COMFY_PORT, timeout=5)
    try:
        payload = json.dumps({"delete": [str(job_id)]}).encode("utf-8")
        conn.request(
            "POST",
            "/history",
            body=payload,
            headers={"Content-Type": "application/json", "Connection": "close"},
        )
        resp = conn.getresponse()
        resp.read()
        return 200 <= resp.status < 300
    except (OSError, http.client.HTTPException):
        return False
    finally:
        conn.close()


def delete_generated_video(
    filename: str,
    subfolder: str = "",
    file_type: str = "output",
    job_id: str | None = None,
) -> dict:
    """Safely delete a generated video file under COMFY_OUTPUT_DIR and remove its ComfyUI history."""
    if file_type != "output":
        raise ValueError("อนุญาตให้ลบเฉพาะไฟล์ในโฟลเดอร์ output เท่านั้น")
    clean_name = (filename or "").strip()
    if not clean_name or "/" in clean_name or "\\" in clean_name or ".." in clean_name:
        raise ValueError("ชื่อไฟล์ไม่ถูกต้อง")
    if not VIDEO_EXT_RE.search(clean_name):
        raise ValueError("รองรับการลบเฉพาะไฟล์วิดีโอ (.mp4, .webm, .mov, .mkv)")

    clean_sub = (subfolder or "").strip().strip("/\\")
    if ".." in clean_sub.split("/") or ".." in clean_sub.split("\\"):
        raise ValueError("โฟลเดอร์ย่อยไม่ถูกต้อง")

    output_root = Path(os.path.realpath(str(COMFY_OUTPUT_DIR)))
    candidate = Path(os.path.realpath(str(output_root / clean_sub / clean_name)))

    # Strict path traversal check: candidate must reside inside output_root
    if output_root not in candidate.parents:
        raise ValueError("ไม่อนุญาตให้เข้าถึงไฟล์นอกโฟลเดอร์ output")

    freed_bytes = 0
    deleted_file = False
    if candidate.is_file():
        freed_bytes = candidate.stat().st_size
        candidate.unlink()
        deleted_file = True
        # Also remove companion audio/png preview files if ComfyUI VHS created any with same stem
        stem = candidate.stem
        for sibling in candidate.parent.glob(f"{stem}*"):
            if sibling.is_file() and output_root in Path(os.path.realpath(str(sibling))).parents:
                try:
                    freed_bytes += sibling.stat().st_size
                    sibling.unlink()
                except OSError:
                    pass

    history_removed = _delete_comfy_history_item(job_id) if job_id else False
    return {
        "ok": True,
        "deleted_file": deleted_file,
        "history_removed": history_removed,
        "freed_bytes": freed_bytes,
        "filename": clean_name,
        "subfolder": clean_sub,
        "job_id": job_id,
    }

