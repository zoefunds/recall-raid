# Multi-stage build for Fly.io. Produces a small, non-root runtime image.

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

# Non-root user for the runtime container.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs recallraid
USER recallraid

# Fly.io injects PORT at runtime (see fly.toml's internal_port, which must
# match the app's default PORT env var) — EXPOSE here is documentation only,
# Docker's EXPOSE cannot reference a runtime-only env var.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
