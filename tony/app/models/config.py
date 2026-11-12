"""Centralized configuration and paths for Tony Studio."""
import os
from pathlib import Path


def env(tony_key: str, legacy_key: str | None = None, default: str = "") -> str:
    """Read TONY_* environment variable first, with optional fallback to legacy KENDO_*."""
    val = os.environ.get(tony_key, "").strip()
    if val:
        return val
    if legacy_key:
        legacy_val = os.environ.get(legacy_key, "").strip()
        if legacy_val:
            return legacy_val
    return default


TONY_ROOT = Path("/opt/tony")
APP_ROOT = TONY_ROOT / "app"
VIEWS_ROOT = TONY_ROOT / "views"
PAGES_ROOT = VIEWS_ROOT / "pages"
ASSETS_ROOT = VIEWS_ROOT / "assets"

WORKSPACE_ROOT = Path(env("TONY_WORKSPACE_ROOT", None, "/workspace"))
COMFYUI_DIR = Path(env("TONY_COMFYUI_DIR", None, str(WORKSPACE_ROOT / "runpod-slim" / "ComfyUI")))
COMFY_OUTPUT_DIR = COMFYUI_DIR / "output"
COMFY_INPUT_DIR = COMFYUI_DIR / "input"

MODEL_ROOT = env("TONY_MODEL_ROOT", "KENDO_MODEL_ROOT", str(COMFYUI_DIR / "models"))
READY_FILE = env("TONY_READY_FILE", "KENDO_READY_FILE", str(WORKSPACE_ROOT / ".tony-h3-v3-models-ready"))
ERROR_FILE = env("TONY_ERROR_FILE", "KENDO_ERROR_FILE", str(WORKSPACE_ROOT / ".tony-h3-v3-models-error"))
LOCK_FILE = env("TONY_LOCK_FILE", None, str(WORKSPACE_ROOT / ".tony-model-download.lock"))

VERSION = env("TONY_IMAGE_VERSION", "KENDO_IMAGE_VERSION", "3.0.0-tony.1")
MODEL_PROFILE = env("TONY_MODEL_PROFILE", "KENDO_MODEL_PROFILE", "fast").lower()
ACTIVE_MODELS_RAW = env("TONY_ACTIVE_MODELS", None, "both").lower()

LISTEN_HOST = env("TONY_PAGE_HOST", "KENDO_PAGE_HOST", "0.0.0.0")
LISTEN_PORT = int(env("TONY_PAGE_PORT", "KENDO_PAGE_PORT", "3000"))

COMFY_HOST = env("TONY_COMFY_HOST", "KENDO_COMFY_HOST", "127.0.0.1")
COMFY_PORT = int(env("TONY_COMFY_PORT", "KENDO_COMFY_PORT", "8188"))

MCP_BIND_HOST = env("TONY_MCP_HOST", "KENDO_MCP_HOST", "0.0.0.0")
MCP_HOST = "127.0.0.1" if MCP_BIND_HOST in ("0.0.0.0", "::") else MCP_BIND_HOST
MCP_PORT = int(env("TONY_MCP_PORT", "KENDO_MCP_PORT", "3001"))
MCP_CODE_FILE = env("TONY_MCP_CODE_FILE", "KENDO_MCP_CODE_FILE", str(WORKSPACE_ROOT / ".tony-mcp-code"))
MCP_PUBLIC_URL = env("TONY_MCP_PUBLIC_URL", "KENDO_MCP_PUBLIC_URL", "")

STUDIO_HOST = env("TONY_STUDIO_HOST", "KENDO_STUDIO_HOST", "127.0.0.1")
STUDIO_PORT = int(env("TONY_STUDIO_PORT", "KENDO_STUDIO_PORT", "8766"))

RUNTIME_FILE = env("TONY_RUNTIME_FILE", "KENDO_RUNTIME_FILE", str(WORKSPACE_ROOT / "tony-runtime.json"))
COMFY_LOG_FILE = env("TONY_COMFY_LOG_FILE", "KENDO_COMFY_LOG_FILE", str(WORKSPACE_ROOT / "comfyui.log"))
GPU_LOG_FILE = env("TONY_GPU_LOG_FILE", "KENDO_GPU_LOG_FILE", "")
MAX_LOG_BYTES = 192 * 1024

PROXY_PREFIX = "/api/comfy"
API_PREFIX = "/api/tony"
LEGACY_API_PREFIX = "/api/kendo"

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

