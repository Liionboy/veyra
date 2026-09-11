FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm ci

COPY apps ./apps
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ARG VEYRA_VERSION=dev
ARG VEYRA_SOURCE=https://github.com/Liionboy/veyra
ENV NODE_ENV=production \
    VEYRA_HOST=0.0.0.0 \
    VEYRA_PORT=8080 \
    VEYRA_DATA_DIR=/data
LABEL org.opencontainers.image.title="Veyra" \
      org.opencontainers.image.description="Private file sharing, beautifully self-hosted." \
      org.opencontainers.image.version="${VEYRA_VERSION}" \
      org.opencontainers.image.source="${VEYRA_SOURCE}" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
RUN apk upgrade --no-cache \
    && mkdir -p /data \
    && chown node:node /data \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --chown=node:node LICENSE ./LICENSE
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
