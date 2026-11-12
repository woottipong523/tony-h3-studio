#!/usr/bin/env python3
"""Detect the RunPod GPU and make the global Sage choice observable for Tony Studio."""
import json
import os
import subprocess
import sys
from pathlib import Path

TONY_ROOT = Path(__file__).resolve().parent.parent
if str(TONY_ROOT) not in sys.path:
    sys.path.insert(0, str(TONY_ROOT))

from app.models.config import RUNTIME_FILE, WORKSPACE_ROOT, env  # noqa: E402

ARGS_FILE = Path(env("TONY_COMFY_ARGS_FILE", "KENDO_COMFY_ARGS_FILE", str(WORKSPACE_ROOT / "runpod-slim" / "comfyui_args.txt")))
RUNTIME_PATH = Path(RUNTIME_FILE)
SAGE_FLAG = "--use-sage-attention"


def command(*args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=15).strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def gpu_details():
    result = {"name": "Unknown GPU", "vram_gb": None, "compute_capability": None, "driver": None}
    try:
        import torch
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            result.update(
                name=props.name,
                vram_gb=round(props.total_memory / (1024 ** 3), 1),
                compute_capability=f"{props.major}.{props.minor}",
            )
    except Exception as error:
        result["probe_error"] = f"{type(error).__name__}: {error}"
    driver = command("nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader", "-i", "0")
    if driver:
        result["driver"] = driver.splitlines()[0].strip()
    return result


def sage_import():
    try:
        import sageattention
        return True, getattr(sageattention, "__version__", None) or "installed", None
    except Exception as error:
        return False, None, f"{type(error).__name__}: {error}"


def configure_args(active):
    ARGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    lines = ARGS_FILE.read_text(encoding="utf-8").splitlines() if ARGS_FILE.exists() else []
    lines = [line for line in lines if line.strip() != SAGE_FLAG]
    if active:
        lines.append(SAGE_FLAG)
    ARGS_FILE.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def main():
    gpu = gpu_details()
    requested = env("TONY_ENABLE_SAGE", "KENDO_ENABLE_SAGE", "1") == "1"
    available, version, error = sage_import()
    compatible = gpu.get("compute_capability") == "12.0"
    active = requested and available and compatible
    configure_args(active)
    reason = None
    if not requested:
        reason = "disabled by TONY_ENABLE_SAGE"
    elif not available:
        reason = error or "sageattention import failed"
    elif not compatible:
        reason = f"GPU compute capability {gpu.get('compute_capability') or 'unknown'} is not sm_120"
    runtime = {
        "setup": env("TONY_IMAGE_VERSION", "KENDO_IMAGE_VERSION", "runpod"),
        "model_profile": env("TONY_MODEL_PROFILE", "KENDO_MODEL_PROFILE", "fast"),
        "gpu": gpu,
        "sage": {
            "requested": requested,
            "available": available,
            "compatible": compatible,
            "active": active,
            "version": version,
            "reason": reason,
        },
        "attention": "Sage Global · ACTIVE" if active else "Native · FALLBACK",
    }
    RUNTIME_PATH.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_PATH.write_text(json.dumps(runtime, ensure_ascii=False, indent=2), encoding="utf-8")
    capability = str(gpu.get("compute_capability") or "?").replace(".", "")
    print(f"[TONY] GPU detected: {gpu['name']} · {gpu.get('vram_gb') or '?'} GB · sm_{capability}")
    if active:
        print(f"[TONY] SageAttention ACTIVE ({version})")
    else:
        print(f"[TONY] SageAttention FALLBACK to Native: {reason}")
    return active


if __name__ == "__main__":
    raise SystemExit(0 if main() else 10)

