"""Model manifest, active model selection, and download status for Tony Studio."""
import os
from pathlib import Path
from app.models.config import (
    ACTIVE_MODELS_RAW,
    ERROR_FILE,
    MODEL_PROFILE,
    MODEL_ROOT,
    READY_FILE,
)

REPO = "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/"
SINGULARITY_REPO = "https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/main/"

COMMON_SPECS = (
    ("text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", 15_687_142_551),
    ("vae/minimax_h3_video_vae_fp16.safetensors", 5_207_808_496),
    ("vae/minimax_h3_audio_vae_fp32.safetensors", 605_254_808),
    ("loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors", 1_956_193_000),
)

FAST_DIFFUSION_BY_KEY = {
    "original": ("diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors", 20_970_379_616),
    "singularity": ("diffusion_models/Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors", 20_967_647_456),
}

QUALITY_DIFFUSION_SPECS = (
    ("diffusion_models/minimax_h3_ref2va_bf16.safetensors", 66_280_487_368),
)


def active_model_keys() -> list[str]:
    """Return active model keys based on TONY_MODEL_PROFILE and TONY_ACTIVE_MODELS."""
    if MODEL_PROFILE == "quality":
        return ["original-bf16"]
    raw = (os.environ.get("TONY_ACTIVE_MODELS") or ACTIVE_MODELS_RAW or "both").strip().lower()
    if raw in ("", "both", "all"):
        return ["original", "singularity"]
    keys = [k.strip() for k in raw.split(",") if k.strip() in FAST_DIFFUSION_BY_KEY]
    return keys or ["original", "singularity"]


def get_model_specs() -> tuple[tuple[str, int], ...]:
    """Return tuple of (relative_path, expected_bytes) for active configuration."""
    if MODEL_PROFILE == "quality":
        return QUALITY_DIFFUSION_SPECS + COMMON_SPECS
    keys = active_model_keys()
    diffusion = tuple(FAST_DIFFUSION_BY_KEY[k] for k in keys if k in FAST_DIFFUSION_BY_KEY)
    return diffusion + COMMON_SPECS


MODEL_SPECS = get_model_specs()


def model_url(relative: str) -> str:
    basename = os.path.basename(relative)
    if basename.startswith("Minimax-h3_Singularity_"):
        return f"{SINGULARITY_REPO}{basename}?download=true"
    return f"{REPO}{relative}?download=true"


def files_ready() -> bool:
    specs = get_model_specs()
    return all(
        os.path.isfile(os.path.join(MODEL_ROOT, rel))
        and os.path.getsize(os.path.join(MODEL_ROOT, rel)) == expected
        for rel, expected in specs
    )


def download_status() -> dict:
    specs = get_model_specs()
    total = sum(size for _, size in specs)
    downloaded = 0
    for relative, size in specs:
        target = os.path.join(MODEL_ROOT, relative)
        candidate = target if os.path.isfile(target) else f"{target}.part"
        try:
            downloaded += min(os.path.getsize(candidate), size)
        except OSError:
            pass

    error = None
    try:
        err_text = Path(ERROR_FILE).read_text(encoding="utf-8").strip()
        if err_text:
            error = err_text
    except OSError:
        error = None

    progress = round(downloaded * 100 / total, 1) if total > 0 else 100.0
    return {
        "models_ready": files_ready(),
        "download_error": error,
        "downloaded_bytes": downloaded,
        "total_bytes": total,
        "progress": progress,
        "active_models": active_model_keys(),
    }

