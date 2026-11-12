"""File deletion controller for Tony Studio."""
import json
from app.models.comfy_model import comfy_bridge
from app.models.file_model import delete_generated_video
from app.models.runtime_model import disk_status


def _send_json(handler, status: int, body: dict) -> None:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def handle_delete_file(handler) -> None:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0 or length > 64 * 1024:
        _send_json(handler, 400, {"error": "คำขอไม่ถูกต้อง"})
        return
    try:
        data = json.loads(handler.rfile.read(length).decode("utf-8"))
    except ValueError:
        _send_json(handler, 400, {"error": "รูปแบบ JSON ไม่ถูกต้อง"})
        return

    try:
        result = delete_generated_video(
            filename=data.get("filename", ""),
            subfolder=data.get("subfolder", ""),
            file_type=data.get("type", "output"),
            job_id=data.get("jobId") or data.get("job_id"),
        )
        result["disk"] = disk_status()
        comfy_bridge._broadcast("files_deleted", {"deleted": result})
        _send_json(handler, 200, result)
    except ValueError as error:
        _send_json(handler, 400, {"error": str(error)})
    except OSError as error:
        _send_json(handler, 500, {"error": f"ลบไฟล์ไม่สำเร็จ: {error}"})

