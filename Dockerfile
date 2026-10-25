# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@9.11.0
COPY package.json pnpm-lock.yaml ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && pnpm install --frozen-lockfile \
  && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json tsup.config.ts vite.config.ts ./
COPY src ./src
COPY web ./web
COPY catalog ./catalog
COPY assets ./assets
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    BOT_DATA_DIR=/data \
    BOT_HOST=0.0.0.0 \
    BOT_PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/catalog ./catalog
COPY --from=build /app/assets ./assets
COPY package.json config.example.yaml ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
