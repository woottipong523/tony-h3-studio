#!/usr/bin/env bash
set -Eeuo pipefail

export TONY_WORKFLOW_FILE="/opt/tony/views/assets/js/models/workflow-v3-beta.js"
export TONY_IMAGE_WORKFLOW_FILE="/opt/tony/views/assets/js/models/workflow-images.js"
export TONY_PAGE_ROOT="/opt/tony/views/pages"
export TONY_COMFY_LOG_FILE="${TONY_COMFY_LOG_FILE:-/workspace/comfyui.log}"
export TONY_KIE_DATA_DIR="${TONY_KIE_DATA_DIR:-/workspace/tony-kie}"

args_file=/workspace/runpod-slim/comfyui_args.txt
mkdir -p "$(dirname "$args_file")"
touch "$args_file"
if ! grep -q -- '--max-upload-size' "$args_file"; then
  echo '--max-upload-size 512' >> "$args_file"
fi

# Detect the assigned GPU and enable the baked sm_120 Sage kernel only when it
# imports successfully on a compatible Blackwell card.
if python3 /opt/tony/bin/detect_runpod_runtime.py; then
  export TONY_ENABLE_SAGE=1
else
  export TONY_ENABLE_SAGE=0
fi

# Claude connection code: honour the template env, otherwise keep one per workspace.
code_file="${TONY_MCP_CODE_FILE:-/workspace/.tony-mcp-code}"
export TONY_MCP_HOST="${TONY_MCP_HOST:-0.0.0.0}"
if [[ -z "${TONY_MCP_CODE:-}" ]]; then
  if [[ ! -s "$code_file" ]]; then
    python3 -c 'import secrets; print("tony-" + secrets.token_hex(8))' > "$code_file"
  fi
  export TONY_MCP_CODE="$(tr -d '[:space:]' < "$code_file")"
fi

nohup /opt/node/bin/node /opt/tony-mcp/server.mjs \
  > /workspace/tony-mcp.log 2>&1 &
echo "[TONY v3] Claude MCP server listening on ${TONY_MCP_HOST}:${TONY_MCP_PORT:-3001}; log: /workspace/tony-mcp.log"

nohup /opt/node/bin/node /opt/tony-mcp/studio-server.mjs \
  > /workspace/tony-studio.log 2>&1 &
echo '[TONY Studio] Seedance: /seedance25.html'

if [[ "${TONY_ENABLE_IMAGES:-1}" == "1" && -n "${TONY_IMAGE_MODELS:-}" ]]; then
  if [[ ! -d /workspace/runpod-slim/ComfyUI ]]; then
    mkdir -p /workspace/runpod-slim
    cp -a /opt/comfyui-baked /workspace/runpod-slim/ComfyUI
  fi
  nohup python3 /opt/tony/bin/download_image_models.py \
    > /workspace/tony-image-download.log 2>&1 &
fi

touch "$TONY_COMFY_LOG_FILE"
exec /opt/tony/bin/entrypoint.sh > >(tee -a "$TONY_COMFY_LOG_FILE") 2>&1

