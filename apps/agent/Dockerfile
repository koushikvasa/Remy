# Agent server image (Railway). Build context = repo root.
FROM node:20-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Workspace manifests first for layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/agent/package.json ./apps/agent/

RUN pnpm install --filter @remy/agent... --frozen-lockfile

# Source.
COPY packages/shared ./packages/shared
COPY apps/agent ./apps/agent

WORKDIR /app/apps/agent
EXPOSE 8080
CMD ["pnpm", "start"]
