# ---------- deps ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app

# Prisma detect needs the openssl binary to decide the right engine
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Helpful: force Prisma’s postinstall to fetch the OpenSSL 3 engine
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x

COPY package.json package-lock.json .npmrc* ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/ai/package.json ./packages/ai/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN npm ci --workspaces --include-workspace-root

# ---------- builder ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN node -e "process.chdir('packages/ai');try{require.resolve('openai/package.json');process.exit(0)}catch(e){process.exit(1)}" \
 || npm ci -w packages/ai --include-workspace-root || npm install -w packages/ai --no-audit --no-fund
# If express is missing, install just the API workspace deps.
RUN node -e "try{require.resolve('express/package.json');process.exit(0)}catch(e){process.exit(1)}" \
 || npm ci -w apps/api --include-workspace-root || npm install -w apps/api --no-audit --no-fund


RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# keep same env here too (safety for any nested installs)
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 1) Generate Prisma client in the DB package (now targets openssl 3)
RUN npm run -w packages/db prisma:gen

# 2) Build internal packages
RUN npm run -w packages/db build
RUN npm run -w packages/ai build

# 3) Build API
RUN npm run -w apps/api build

# ---------- runner ----------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Runtime also needs the library present
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Easiest + most robust: copy the whole built tree
COPY --from=builder /app /app

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
