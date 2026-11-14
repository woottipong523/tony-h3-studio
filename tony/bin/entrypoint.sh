#!/usr/bin/env bash
set -Eeuo pipefail

COMFYUI_DIR="/workspace/runpod-slim/ComfyUI"
BAKED_DIR="/opt/comfyui-baked"
ARGS_FILE="/workspace/runpod-slim/comfyui_args.txt"

echo "[TONY] Preparing MiniMax H3 environment (Container Disk / Workspace)"
df -h /workspace || true

if [[ ! -d "$COMFYUI_DIR" ]]; then
  mkdir -p "$(dirname "$COMFYUI_DIR")"
  cp -a "$BAKED_DIR" "$COMFYUI_DIR"
  echo "[TONY] Copied baked ComfyUI ${TONY_IMAGE_VERSION:-3.0.0-tony.1} to workspace"
fi

for node in ComfyUI-VideoHelperSuite ComfyUI-ALLinONE-MinimaxH3; do
  if [[ ! -d "$COMFYUI_DIR/custom_nodes/$node" ]]; then
    cp -a "$BAKED_DIR/custom_nodes/$node" "$COMFYUI_DIR/custom_nodes/$node"
    echo "[TONY] Restored required node: $node"
  fi
done

if [[ -d /opt/tony/workflows ]]; then
  mkdir -p "$COMFYUI_DIR/user/default/workflows"
  cp -f /opt/tony/workflows/*.json "$COMFYUI_DIR/user/default/workflows/" 2>/dev/null || true
  echo "[TONY] Preloaded default MiniMax H3 workflows into ComfyUI"
fi

mkdir -p "$(dirname "$ARGS_FILE")"
touch "$ARGS_FILE"
if [[ "${TONY_ENABLE_SAGE:-1}" == "1" ]] && \
   ! grep -qxF -- "--use-sage-attention" "$ARGS_FILE"; then
  echo "--use-sage-attention" >> "$ARGS_FILE"
fi
if ! grep -qxF -- "--enable-cors-header" "$ARGS_FILE"; then
  echo "--enable-cors-header" >> "$ARGS_FILE"
fi

if [[ "${TONY_AUTO_DOWNLOAD_MODELS:-1}" == "1" ]]; then
  if [[ "${TONY_WAIT_FOR_MODELS:-0}" == "1" ]]; then
    echo "[TONY] Waiting for all MiniMax H3 models before starting services"
    /opt/tony/bin/download-models.sh \
      > >(tee /workspace/tony-model-download.log) 2>&1
    echo "[TONY] Models verified; starting ComfyUI services"
  else
    nohup /opt/tony/bin/download-models.sh \
      > /workspace/tony-model-download.log 2>&1 &
    echo "[TONY] Model downloader started in background; log: /workspace/tony-model-download.log"
  fi
fi

nohup python3 /opt/tony/app/server.py \
  > /workspace/tony-page.log 2>&1 &
echo "[TONY] MVC Studio Page and ComfyUI proxy started on port 3000"

exec /start.sh

