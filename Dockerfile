# Untested in this repository's CI sandbox (no Docker available there) — build and smoke-test before relying on it.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci && npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 CHROMIUM_PATH=/usr/bin/chromium WEB_DIST=/app/apps/web/dist
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
