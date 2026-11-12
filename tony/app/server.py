#!/usr/bin/env python3
"""Tony Studio MVC Web Server Entrypoint (:3000)."""
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

# Ensure /opt/tony is on sys.path so `app.*` imports resolve cleanly
TONY_ROOT = Path(__file__).resolve().parent.parent
if str(TONY_ROOT) not in sys.path:
    sys.path.insert(0, str(TONY_ROOT))

from app.models.comfy_model import comfy_bridge  # noqa: E402
from app.models.config import (  # noqa: E402
    COMFY_HOST,
    COMFY_PORT,
    LISTEN_HOST,
    LISTEN_PORT,
    PROXY_PREFIX,
)
from app.router import TonyRouterHandler  # noqa: E402


class TonyThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    comfy_bridge.start()
    server = TonyThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), TonyRouterHandler)
    print(
        f"[TONY] MVC Studio Server listening on {LISTEN_HOST}:{LISTEN_PORT}; "
        f"proxying {PROXY_PREFIX} -> http://{COMFY_HOST}:{COMFY_PORT}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()

