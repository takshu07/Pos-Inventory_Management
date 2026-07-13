# ==========================================
# STAGE 1: Build
# ==========================================
FROM node:20-alpine AS builder

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies) to build the app
RUN npm ci

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# ==========================================
# STAGE 2: Production Dependencies
# ==========================================
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
# Install strictly production dependencies
RUN npm ci --omit=dev
RUN npx prisma generate

# ==========================================
# STAGE 3: Runner
# ==========================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV PORT 3000

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 expressjs

# Copy runtime files
COPY --from=builder /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

USER expressjs

EXPOSE 3000

# Tini is recommended for Node.js Docker containers to handle process signals correctly, but Node 20 has decent signal handling.
CMD ["node", "dist/server.js"]
