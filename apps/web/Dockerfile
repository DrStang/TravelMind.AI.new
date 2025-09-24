# ---------- deps ----------
FROM node:24-alpine AS deps
WORKDIR /app

# Root manifests
COPY package.json package-lock.json .npmrc* ./

# Workspace manifests (adjust to what exists)
COPY apps/web/package.json ./apps/web/package.json
# COPY packages/ui/package.json ./packages/ui/package.json
# COPY packages/ai/package.json ./packages/ai/package.json

RUN npm ci --workspaces --include-workspace-root

# ---------- builder ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run -w apps/web build

# ---------- runner ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Next standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
# (remove this next line since you don't have a public dir)
# COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
