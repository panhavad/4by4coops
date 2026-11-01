# syntax=docker/dockerfile:1

# ---- 1. build the static client (Vite + three.js) -------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- 2. runtime: tiny Node server (only dependency: ws) ---------------------------
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY src/shared ./src/shared
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
# Stamped by the auto-updater with the git commit; clients reload when it changes.
ARG GIT_COMMIT=dev
ENV APP_VERSION=$GIT_COMMIT
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/index.js"]
