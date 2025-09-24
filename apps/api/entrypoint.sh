#!/usr/bin/env sh
set -e
echo "Running Prisma migrations..."
npx prisma migrate deploy --schema=packages/db/schema.prisma || true
node apps/api/dist/index.js
