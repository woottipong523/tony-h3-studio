"""Runtime GPU, MCP, and Disk status model for Tony Studio."""
import http.client
import json
import os
import shutil
from urllib.parse import quote
from app.models.config import (
    COMFY_PORT,
    MCP_CODE_FILE,
    MCP_HOST,
    MCP_PORT,
    MCP_PUBLIC_URL,
    RUNTIME_FILE,
    WORKSPACE_ROOT,
    env,
)


def mcp_code() -> str | None:
    code = env("TONY_MCP_CODE", "KENDO_MCP_CODE", "")
    if code:
        return code
    try:
        with open(MCP_CODE_FILE, encoding="utf-8") as stream:
            return stream.read().strip() or None
    except OSError:
        return None


def mcp_url() -> str | None:
    pod = os.environ.get("RUNPOD_POD_ID", "").strip()
    code = mcp_code()
    if not code:
        return None
    if MCP_PUBLIC_URL:
        return MCP_PUBLIC_URL.replace("{code}", quote(code, safe=""))
    if pod:
        return f'https://{pod}-{MCP_PORT}.proxy.runpod.net/mcp/{quote(code, safe="")}'
    return f'http://127.0.0.1:{MCP_PORT}/mcp/{quote(code, safe="")}'


def comfy_url() -> str:
    pod = os.environ.get("RUNPOD_POD_ID", "").strip()
    if pod:
        return f"https://{pod}-{COMFY_PORT}.proxy.runpod.net/"
    return f"http://127.0.0.1:{COMFY_PORT}/"


def mcp_ready() -> bool:
    connection = http.client.HTTPConnection(MCP_HOST, MCP_PORT, timeout=2)
    try:
        connection.request("GET", "/healthz", headers={"Connection": "close"})
        return connection.getresponse().status == 200
    except (ConnectionError, TimeoutError, OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def runtime_status() -> dict:
    try:
        with open(RUNTIME_FILE, encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError):
        return {
            "attention": "กำลังตรวจสอบ",
            "gpu": {"name": "กำลังตรวจสอบ"},
            "sage": {"active": False, "reason": "runtime probe pending"},
        }


def disk_status() -> dict:
    target = str(WORKSPACE_ROOT) if WORKSPACE_ROOT.exists() else "/"
    try:
        usage = shutil.disk_usage(target)
        return {
            "total_gb": round(usage.total / (1024 ** 3), 1),
            "used_gb": round(usage.used / (1024 ** 3), 1),
            "free_gb": round(usage.free / (1024 ** 3), 1),
            "percent": round(usage.used * 100 / usage.total, 1) if usage.total else 0.0,
        }
    except OSError:
        return {"total_gb": 0, "used_gb": 0, "free_gb": 0, "percent": 0}

