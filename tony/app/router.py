"""MVC HTTP Router and Static View Dispatcher for Tony Studio (:3000)."""
import os
from http.server import SimpleHTTPRequestHandler
from urllib.parse import unquote, urlsplit
from app.controllers import (
    file_controller,
    log_controller,
    proxy_controller,
    system_controller,
)
from app.models.config import (
    API_PREFIX,
    ASSETS_ROOT,
    LEGACY_API_PREFIX,
    PAGES_ROOT,
    PROXY_PREFIX,
    VIEWS_ROOT,
)

PAGE_ROUTES = {
    "/": PAGES_ROOT / "index.html",
    "/index.html": PAGES_ROOT / "index.html",
    "/v3-beta.html": PAGES_ROOT / "index.html",
}

ASSET_SHORTCUTS = {
    "/v3-beta.css": ASSETS_ROOT / "css" / "v3-beta.css",
    "/styles.css": ASSETS_ROOT / "css" / "styles.css",
    "/workflow-v3-beta.js": ASSETS_ROOT / "js" / "models" / "workflow-v3-beta.js",
    "/runtime-v4-local.js": ASSETS_ROOT / "js" / "models" / "runtime-v4-local.js",
    "/api-client.js": ASSETS_ROOT / "js" / "services" / "api-client.js",
    "/v3-beta.js": ASSETS_ROOT / "js" / "controllers" / "studio-controller.js",
    "/studio-controller.js": ASSETS_ROOT / "js" / "controllers" / "studio-controller.js",
    "/app.js": ASSETS_ROOT / "js" / "controllers" / "app.js",
}


class TonyRouterHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(VIEWS_ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:
        # Suppress noisy polling/SSE access logs while keeping errors visible
        return

    def end_headers(self) -> None:
        path = urlsplit(self.path).path
        if path in PAGE_ROUTES or path in ASSET_SHORTCUTS or path.startswith("/assets/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        clean_path = unquote(urlsplit(path).path)
        if clean_path in PAGE_ROUTES:
            return str(PAGE_ROUTES[clean_path])
        if clean_path in ASSET_SHORTCUTS:
            return str(ASSET_SHORTCUTS[clean_path])
        if clean_path.startswith("/assets/"):
            rel = clean_path[len("/assets/") :].lstrip("/")
            candidate = os.path.realpath(str(ASSETS_ROOT / rel))
            assets_real = os.path.realpath(str(ASSETS_ROOT))
            if candidate == assets_real or candidate.startswith(assets_real + os.sep):
                return candidate
        return super().translate_path(path)

    def _normalize_api_path(self, raw_path: str) -> str:
        path = urlsplit(raw_path).path
        if path.startswith(LEGACY_API_PREFIX + "/"):
            return API_PREFIX + path[len(LEGACY_API_PREFIX) :]
        return path

    def _is_comfy_request(self) -> bool:
        path = urlsplit(self.path).path
        return path == PROXY_PREFIX or path.startswith(f"{PROXY_PREFIX}/")

    def do_GET(self) -> None:
        api_path = self._normalize_api_path(self.path)
        if api_path == f"{API_PREFIX}/status":
            system_controller.send_status(self, include_body=True)
            return
        if api_path == f"{API_PREFIX}/events":
            system_controller.stream_events(self)
            return
        if api_path == f"{API_PREFIX}/logs":
            log_controller.send_logs(self)
            return
        if api_path == f"{API_PREFIX}/logs/stream":
            log_controller.stream_logs(self)
            return
        if urlsplit(self.path).path.startswith("/api/kie/"):
            proxy_controller.proxy_to_studio(self)
            return
        if self._is_comfy_request():
            proxy_controller.proxy_to_comfy(self, include_body=True)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        api_path = self._normalize_api_path(self.path)
        if api_path == f"{API_PREFIX}/status":
            system_controller.send_status(self, include_body=False)
            return
        if self._is_comfy_request():
            proxy_controller.proxy_to_comfy(self, include_body=False)
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        api_path = self._normalize_api_path(self.path)
        if api_path == f"{API_PREFIX}/files/delete":
            file_controller.handle_delete_file(self)
            return
        if urlsplit(self.path).path.startswith("/api/kie/"):
            proxy_controller.proxy_to_studio(self)
            return
        if self._is_comfy_request():
            proxy_controller.proxy_to_comfy(self, include_body=True)
            return
        self.send_error(404)

