# QuantForge backend: headless editor-tool MCP server + TrueForge agent harness.
#   docker build --target mcp -t quantforge-mcp .
#   docker build --target trueforge -t quantforge-trueforge .
# Use docker-compose.yml to run both together.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY agents ./agents
COPY scripts ./scripts
COPY LICENSE ./
# client-end is intentionally not copied: the backend does not need the React UI.
RUN npm ci --ignore-scripts=false --workspaces --include-workspace-root \
 && node scripts/build.mjs

FROM node:22-bookworm-slim AS mcp
RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-venv python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir pytest
ENV PATH=/opt/py/bin:$PATH PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY --from=build /src/packages/extension/dist ./dist
COPY --from=build /src/agents ./agents
RUN useradd -m -u 10001 qf && mkdir -p /data /workspace && chown qf /data /workspace
USER qf
# The MCP server only ever binds 127.0.0.1 and checks the Host header (by design); TrueForge shares this
# container's network namespace (see docker-compose.yml), so loopback still works and nothing else can reach it.
EXPOSE 8787
VOLUME ["/data"]
# QF_MCP_TOKEN is required. The workspace is bind-mounted at /workspace.
CMD ["sh", "-c", "test -n \"$QF_MCP_TOKEN\" || { echo 'QF_MCP_TOKEN is required' >&2; exit 1; }; exec node dist/forge-mcp.mjs --workspace /workspace --storage /data --port 8787 --token \"$QF_MCP_TOKEN\""]

FROM node:22-bookworm-slim AS trueforge
RUN npm install -g @truefoundry/trueforge@latest && useradd -m -u 10002 tf && mkdir -p /tfdata && chown tf /tfdata
USER tf
ENV SQLITE_PATH=/tfdata/trueforge.db
VOLUME ["/tfdata"]
EXPOSE 8790
CMD ["trueforge"]
