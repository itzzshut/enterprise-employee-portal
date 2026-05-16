# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Enterprise Employee Portal — API image
#
# Three stages so the runtime layer carries neither the TypeScript toolchain
# nor the dev dependencies: ~1.1GB of build context collapses to a ~180MB
# runtime image, which is what actually gets pushed to the registry on every
# Jenkins build.
# ---------------------------------------------------------------------------

# --- Stage 1: dependencies -------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Copy manifests only, so this layer is reused whenever application code
# changes but package-lock.json does not.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- Stage 2: build --------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json knexfile.ts ./
COPY src ./src

RUN npm run build

# --- Stage 3: production dependencies --------------------------------------
# Pruned in its own stage so the build stage keeps the dev tooling (ts-node,
# used by the one-shot migrate service) while the runtime image ships without it.
FROM deps AS prod-deps
RUN npm prune --omit=dev

# --- Stage 4: runtime ------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# dumb-init becomes PID 1 so SIGTERM reaches Node directly and the graceful
# shutdown in server.ts actually runs. Without an init, Node as PID 1 ignores
# default signal semantics and the container is SIGKILLed after the grace
# period, dropping in-flight requests.
RUN apk add --no-cache dumb-init curl \
    && addgroup -S -g 1001 portal \
    && adduser -S -u 1001 -G portal portal

ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--enable-source-maps

COPY --from=prod-deps --chown=portal:portal /app/node_modules ./node_modules
COPY --from=build --chown=portal:portal /app/dist ./dist
COPY --from=build --chown=portal:portal /app/package.json ./package.json

# Writable mounts for uploads and logs, owned by the unprivileged user.
RUN mkdir -p /app/storage/uploads/avatars /app/storage/uploads/documents /app/logs \
    && chown -R portal:portal /app/storage /app/logs

USER portal
EXPOSE 4000

# Hits the liveness probe, which deliberately does not touch MySQL — a database
# blip should not make Docker restart a healthy API container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:4000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
