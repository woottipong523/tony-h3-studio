"""Download pinned Qwen Image 2.1 files; opt in with TONY_IMAGE_MODELS."""
import argparse
import os
from pathlib import Path
import subprocess
import time

REVISION = 'df94239739eef7205973a145ffa6f441f7b64e84'
REPO = f'https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/{REVISION}/'
COMMON = (
    ('text_encoders/qwen3vl_8b_int8_convrot.safetensors', 9350798360),
    ('vae/qwen_image_2.1_vae_bf16.safetensors', 675509688),
)
DIFFUSION = {
    'qwen21-turbo': ('diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors', 7256787829),
    'qwen21': ('diffusion_models/qwen_image_2.1_int8_convrot.safetensors', 7256783064),
}


def selected_specs(names):
    selected = [name.strip() for name in names.split(',') if name.strip()]
    if not selected or any(name not in DIFFUSION for name in selected):
        raise ValueError('Choose qwen21-turbo, qwen21, or both separated by a comma')
    return tuple(DIFFUSION[name] for name in dict.fromkeys(selected)) + COMMON


def download(root, relative, expected):
    target = Path(root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size == expected:
        print('Reusing ' + relative, flush=True)
        return
    if target.exists():
        target.rename(str(target) + '.incomplete.' + str(time.time_ns()))
    partial = Path(str(target) + '.part')
    subprocess.run([
        'aria2c', '--continue=true', '--auto-file-renaming=false', '--allow-overwrite=true',
        '--file-allocation=none', '--max-tries=20', '--retry-wait=5',
        '--max-connection-per-server=4', '--split=4', '--min-split-size=16M',
        '--dir=' + str(target.parent), '--out=' + partial.name, REPO + relative
    ], check=True)
    if partial.stat().st_size != expected:
        raise RuntimeError('Incomplete model: ' + relative)
    partial.replace(target)


def main():
    default_models = os.environ.get('TONY_IMAGE_MODELS') or os.environ.get('KENDO_IMAGE_MODELS', 'qwen21-turbo')
    default_root = os.environ.get('TONY_MODEL_ROOT') or os.environ.get('KENDO_MODEL_ROOT', '/workspace/runpod-slim/ComfyUI/models')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', default=default_models)
    parser.add_argument('--root', default=default_root)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    specs = selected_specs(args.models)
    if args.dry_run:
        for relative, size in specs:
            print(f'{relative}: {size:,} bytes')
        print(f'Total: {sum(size for _, size in specs):,} bytes')
        return
    import fcntl
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / '.tony-image-download.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for relative, size in specs:
            download(root, relative, size)


if __name__ == '__main__':
    main()

