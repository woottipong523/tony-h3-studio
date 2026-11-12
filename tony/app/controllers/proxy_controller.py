"""Reverse proxy controller for ComfyUI (:8188) and Tony Studio Service (:8766)."""
import http.client
import json
from urllib.parse import urlsplit
from app.models.config import (
    COMFY_HOST,
    COMFY_PORT,
    HOP_BY_HOP_HEADERS,
    PROXY_PREFIX,
    STUDIO_HOST,
    STUDIO_PORT,
)


def _upstream_comfy_path(raw_path: str) -> str:
    parsed = urlsplit(raw_path)
    path = parsed.path[len(PROXY_PREFIX) :] or "/"
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{path}?{parsed.query}" if parsed.query else path


def _comfy_request_headers(handler) -> dict[str, str]:
    headers = {}
    for name, value in handler.headers.items():
        lowered = name.lower()
        if lowered in HOP_BY_HOP_HEADERS or lowered in {"host", "origin", "referer"}:
            continue
        headers[name] = value
    headers["Host"] = f"{COMFY_HOST}:{COMFY_PORT}"
    headers["Connection"] = "close"
    return headers


def proxy_to_comfy(handler, include_body: bool = True) -> None:
    content_length = int(handler.headers.get("Content-Length", "0") or "0")
    body = handler.rfile.read(content_length) if content_length else None
    connection = http.client.HTTPConnection(COMFY_HOST, COMFY_PORT, timeout=120)

    try:
        connection.request(
            handler.command,
            _upstream_comfy_path(handler.path),
            body=body,
            headers=_comfy_request_headers(handler),
        )
        response = connection.getresponse()
        handler.send_response(response.status, response.reason)
        for name, value in response.getheaders():
            if name.lower() not in HOP_BY_HOP_HEADERS:
                handler.send_header(name, value)
        handler.send_header("Connection", "close")
        handler.end_headers()
        handler.close_connection = True

        if include_body:
            while chunk := response.read(1024 * 256):
                handler.wfile.write(chunk)
    except (ConnectionError, TimeoutError, OSError, http.client.HTTPException) as error:
        payload = json.dumps(
            {"error": "ComfyUI is not ready", "detail": str(error)},
            ensure_ascii=False,
        ).encode("utf-8")
        handler.send_response(503)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        if include_body:
            handler.wfile.write(payload)
    finally:
        connection.close()


def proxy_to_studio(handler) -> None:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length > 30 * 1024 * 1024:
        handler.send_error(413)
        return
    payload = handler.rfile.read(length) if length else None
    headers = {
        k: v for k, v in handler.headers.items() if k.lower() not in HOP_BY_HOP_HEADERS
    }
    headers["Connection"] = "close"
    connection = http.client.HTTPConnection(STUDIO_HOST, STUDIO_PORT, timeout=180)
    try:
        connection.request(handler.command, handler.path, body=payload, headers=headers)
        response = connection.getresponse()
        handler.send_response(response.status)
        for name, value in response.getheaders():
            if name.lower() not in HOP_BY_HOP_HEADERS:
                handler.send_header(name, value)
        handler.send_header("Connection", "close")
        handler.end_headers()
        handler.close_connection = True
        while chunk := response.read(256 * 1024):
            handler.wfile.write(chunk)
    except (OSError, http.client.HTTPException):
        if not handler.close_connection:
            handler.send_error(503, "Studio service is not ready")
    finally:
        connection.close()

