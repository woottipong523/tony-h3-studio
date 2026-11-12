#!/usr/bin/env python3
"""Parallel, resumable model downloader for Tony Studio using MVC model_registry."""
import concurrent.futures
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time

TONY_ROOT = Path(__file__).resolve().parent.parent
if str(TONY_ROOT) not in sys.path:
    sys.path.insert(0, str(TONY_ROOT))

from app.models.config import ERROR_FILE, LOCK_FILE, MODEL_ROOT, READY_FILE, env  # noqa: E402
from app.models.model_registry import get_model_specs, model_url  # noqa: E402


def download(relative: str, expected: int) -> None:
    target = Path(MODEL_ROOT, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size == expected:
        print("[TONY v3] Reusing " + relative, flush=True)
        return
    if target.exists():
        target.rename(str(target) + ".incomplete." + str(time.time_ns()))
    partial = Path(str(target) + ".part")
    conn_raw = env("TONY_CONNECTIONS_PER_FILE", "KENDO_CONNECTIONS_PER_FILE", "4")
    connections = str(max(1, min(16, int(conn_raw))))
    subprocess.run(
        [
            "aria2c",
            "--continue=true",
            "--allow-overwrite=true",
            "--auto-file-renaming=false",
            "--file-allocation=none",
            "--max-tries=20",
            "--retry-wait=5",
            "--connect-timeout=30",
            "--timeout=60",
            "--min-split-size=16M",
            "--summary-interval=5",
            "--max-connection-per-server=" + connections,
            "--split=" + connections,
            "--dir=" + str(target.parent),
            "--out=" + partial.name,
            model_url(relative),
        ],
        check=True,
    )
    if partial.stat().st_size != expected:
        raise RuntimeError("Incorrect size: " + relative)
    partial.replace(target)
    print("[TONY v3] Ready " + relative, flush=True)


def main() -> None:
    specs = get_model_specs()
    Path(LOCK_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_FILE, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        Path(READY_FILE).unlink(missing_ok=True)
        Path(ERROR_FILE).unlink(missing_ok=True)
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                futures = [pool.submit(download, *spec) for spec in specs]
                for future in concurrent.futures.as_completed(futures):
                    future.result()
            Path(READY_FILE).write_text("tony v3 ready\n", encoding="utf-8")
        except Exception as error:
            Path(ERROR_FILE).write_text(str(error), encoding="utf-8")
            raise


if __name__ == "__main__":
    main()

