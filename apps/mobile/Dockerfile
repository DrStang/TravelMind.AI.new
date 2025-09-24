FROM node:24-bullseye AS deps
WORKDIR /app

# root manifest + lockfile
COPY package.json package-lock.json .npmrc* ./

# workspace manifests needed for npm to resolve
COPY apps/mobile/package.json ./apps/mobile/package.json

# install all workspaces from root lockfile (works even if mobile is just a leaf)
RUN npm ci --workspaces --include-workspace-root

FROM node:24-bullseye AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Expo CLI (optional, handy inside container)
RUN npm i -g expo@latest

WORKDIR /app/apps/mobile
EXPOSE 8081 19000 19001 19002
ENV EXPO_NO_TELEMETRY=1
CMD ["npm", "run", "start"]
