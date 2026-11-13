# ============================================================================
# Tony Studio (MiniMax H3 · Full Autonomous Build · 100% Clean)
# Base: Official PyTorch 2.8 + CUDA 12.8 (required for RTX 5090 / Blackwell sm_120)
# ============================================================================
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_VERSION=v22.23.2 \
    PATH="/opt/node/bin:${PATH}"

# 1. Install system utilities, video codecs, and download tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    aria2 \
    curl \
    ca-certificates \
    ffmpeg \
    git \
    git-lfs \
    libgl1 \
    libglib2.0-0 \
    openssh-server \
    openssh-client \
    rsync \
    procps \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# 2. Install FileBrowser standalone binary for web workspace management
RUN curl -fsSL https://github.com/filebrowser/filebrowser/releases/download/v2.32.0/linux-amd64-filebrowser.tar.gz | \
    tar -xz -C /usr/local/bin filebrowser && chmod +x /usr/local/bin/filebrowser

# 3. Ensure python, python3, and python3.12 aliases exist system-wide
RUN ln -sf $(which python3 || which python) /usr/local/bin/python && \
    ln -sf $(which python3 || which python) /usr/local/bin/python3 && \
    ln -sf $(which python3 || which python) /usr/local/bin/python3.12

# 4. Install Node.js LTS (v22) for Tony MCP Server
RUN mkdir -p /opt/node && \
    curl -fsSL https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz | \
    tar -xJ -C /opt/node --strip-components=1

# 5. Install pinned Python dependencies
COPY pip-requirements.txt /tmp/pip-requirements.txt
RUN pip install --no-cache-dir -r /tmp/pip-requirements.txt && \
    rm -f /tmp/pip-requirements.txt

# 5b. SageAttention is optional (no prebuilt sm_120 wheel on PyPI); never fail the build
RUN pip install --no-cache-dir sageattention==2.2.0 || \
    echo "[WARN] sageattention not installed - runtime will fall back to native attention"

# 6. Clone and setup ComfyUI official release + verified custom nodes
RUN git clone --depth 1 -b v0.33.2 https://github.com/Comfy-Org/ComfyUI.git /opt/comfyui-baked && \
    mkdir -p /opt/comfyui-baked/custom_nodes && \
    cd /opt/comfyui-baked/custom_nodes && \
    git clone --depth 1 https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3.git && \
    git clone --depth 1 https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git && \
    git clone --depth 1 https://github.com/kijai/ComfyUI-KJNodes.git && \
    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Manager.git && \
    git clone --depth 1 https://github.com/MadiatorLabs/ComfyUI-RunpodDirect.git && \
    git clone --depth 1 https://github.com/MoonGoblinDev/Civicomfy.git

# 6b. Install ComfyUI core + custom node requirements (keep the base image's CUDA torch)
RUN TORCH_PIN=$(python3 -c "import torch,torchvision,torchaudio;print(f'torch=={torch.__version__}\ntorchvision=={torchvision.__version__}\ntorchaudio=={torchaudio.__version__}')" 2>/dev/null || python3 -c "import torch;print(f'torch=={torch.__version__}')") && \
    echo "$TORCH_PIN" > /opt/comfyui-runtime-constraints.txt && \
    grep -viE '^(torch|torchvision|torchaudio)([<>=~! ]|$)' /opt/comfyui-baked/requirements.txt > /tmp/comfy-req.txt && \
    pip install --no-cache-dir -c /opt/comfyui-runtime-constraints.txt -r /tmp/comfy-req.txt && \
    for req in /opt/comfyui-baked/custom_nodes/*/requirements.txt; do \
        echo "[BUILD] Installing $req"; \
        pip install --no-cache-dir -c /opt/comfyui-runtime-constraints.txt -r "$req" || \
            echo "[WARN] Some requirements failed for $req"; \
    done && \
    python3 -c "import sqlalchemy, torch; print('[BUILD] torch', torch.__version__, 'cuda', torch.version.cuda, 'archs', torch.cuda.get_arch_list())" && \
    rm -f /tmp/comfy-req.txt

# 7. Copy Tony MVC Application, MCP Server, and Startup Scripts
COPY tony /opt/tony
COPY tony-mcp /opt/tony-mcp
COPY start.sh /start.sh

# 8. Install Tony MCP Node dependencies & permissions
RUN cd /opt/tony-mcp && npm install --omit=dev && \
    chmod +x /start.sh \
             /opt/tony/bin/entrypoint-v3-beta.sh \
             /opt/tony/bin/entrypoint.sh \
             /opt/tony/bin/download-models.sh \
             /opt/tony/bin/download_models_v3_beta.py \
             /opt/tony/bin/download_image_models.py \
             /opt/tony/bin/detect_runpod_runtime.py

# 8. Environment Configuration
ENV TONY_BASE_DIR="/opt/tony" \
    TONY_WORKSPACE_ROOT="/workspace" \
    TONY_MODELS_ROOT="/workspace/ComfyUI/models" \
    TONY_COMFY_DIR="/workspace/runpod-slim/ComfyUI" \
    TONY_COMFY_BAKED_DIR="/opt/comfyui-baked" \
    TONY_COMFY_HOST="127.0.0.1" \
    TONY_COMFY_PORT="8188" \
    TONY_COMFY_LOG_FILE="/workspace/comfyui.log" \
    TONY_RUNTIME_FILE="/workspace/tony-runtime.json" \
    TONY_MCP_CODE_FILE="/workspace/.tony-mcp-code" \
    TONY_READY_FILE="/workspace/.tony-h3-v3-models-ready" \
    TONY_ERROR_FILE="/workspace/.tony-h3-v3-models-error" \
    TONY_WORKFLOW_FILE="/opt/tony/views/assets/js/models/workflow-v3-beta.js" \
    TONY_PAGE_ROOT="/opt/tony/views/pages" \
    TONY_STUDIO_HOST="127.0.0.1" \
    TONY_STUDIO_PORT="8766" \
    TONY_MCP_HOST="0.0.0.0" \
    TONY_MCP_PORT="3001" \
    TONY_PAGE_HOST="0.0.0.0" \
    TONY_PAGE_PORT="3000" \
    TONY_ENABLE_SAGE="1" \
    TONY_AUTO_DOWNLOAD_MODELS="1" \
    TONY_WAIT_FOR_MODELS="0" \
    TONY_ACTIVE_MODELS="both" \
    FILEBROWSER_CONFIG="/workspace/runpod-slim/.filebrowser.json"

EXPOSE 3000 3001 8080 8188

ENTRYPOINT ["/opt/tony/bin/entrypoint-v3-beta.sh"]
