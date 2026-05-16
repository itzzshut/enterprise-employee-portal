# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Enterprise Employee Portal — web image
#
# Builds the Angular bundle with the full toolchain, then ships only the
# compiled static files on nginx. The runtime image contains no Node.js, no
# node_modules and no source maps — roughly 55MB.
# ---------------------------------------------------------------------------

# --- Stage 1: build --------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Production configuration applies the bundle budgets declared in angular.json,
# so an accidental dependency bloat fails the build here rather than shipping.
RUN npm run build:prod

# --- Stage 2: runtime ------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl \
    && rm -rf /usr/share/nginx/html/*

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/web/browser /usr/share/nginx/html

# nginx:alpine already runs workers as the unprivileged `nginx` user; the
# master needs root only to bind port 80 inside the container.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
