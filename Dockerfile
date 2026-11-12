# ============================================================================
# Tony Studio (MiniMax H3 · MVC · Real-time · No Network Volume Required)
# ============================================================================
ARG BASE_IMAGE=ghcr.io/kendo-studio/minimax-h3:v3-beta.17
FROM ${BASE_IMAGE}

# Preserve existing MCP node_modules from base image, then remove legacy kendo dirs
RUN mkdir -p /opt/tony-mcp && \
    if [ -d /opt/kendo-mcp/node_modules ]; then cp -a /opt/kendo-mcp/node_modules /opt/tony-mcp/node_modules; fi && \
    rm -rf /opt/kendo /opt/kendo-page /opt/kendo-mcp

# Copy Tony MVC application, MCP server, and startup script
COPY start.sh /start.sh
COPY tony /opt/tony
COPY tony-mcp /opt/tony-mcp

RUN if [ ! -d /opt/tony-mcp/node_modules ]; then \
      cd /opt/tony-mcp && PATH="/opt/node/bin:$PATH" npm ci --omit=dev; \
    fi && \
    chmod +x /start.sh \
      /opt/tony/bin/*.sh \
      /opt/tony/bin/*.py \
      /opt/tony/app/server.py

# Environment Configuration for Tony Studio (Container Disk / Ephemeral Pod Ready)
ENV TONY_IMAGE_VERSION="3.0.0-tony.1" \
    TONY_COMFY_LOG_FILE="/workspace/comfyui.log" \
    TONY_RUNTIME_FILE="/workspace/tony-runtime.json" \
    TONY_MCP_CODE_FILE="/workspace/.tony-mcp-code" \
    TONY_READY_FILE="/workspace/.tony-h3-v3-models-ready" \
    TONY_ERROR_FILE="/workspace/.tony-h3-v3-models-error" \
    TONY_WORKFLOW_FILE="/opt/tony/views/assets/js/models/workflow-v3-beta.js" \
    TONY_IMAGE_WORKFLOW_FILE="/opt/tony/views/assets/js/models/workflow-images.js" \
    TONY_PAGE_ROOT="/opt/tony/views/pages" \
    TONY_KIE_DATA_DIR="/workspace/tony-kie" \
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

EXPOSE 3000 3001 8080 8188 8888

ENTRYPOINT ["/opt/tony/bin/entrypoint-v3-beta.sh"]

