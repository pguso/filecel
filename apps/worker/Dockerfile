FROM node:22-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/r2/package.json packages/r2/
COPY apps/worker/package.json apps/worker/

RUN npm ci --workspace @filecel/r2 --workspace @filecel/worker --include-workspace-root

COPY packages/r2 packages/r2
COPY apps/worker apps/worker
COPY eslint.config.js .prettierrc.json ./

RUN npm run build -w @filecel/r2 && npm run build -w @filecel/worker

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/r2/package.json packages/r2/
COPY apps/worker/package.json apps/worker/

RUN npm ci --workspace @filecel/r2 --workspace @filecel/worker --include-workspace-root --omit=dev

COPY --from=build /app/packages/r2/dist packages/r2/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist

EXPOSE 3000

CMD ["node", "apps/worker/dist/index.js"]
