# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
WORKDIR /app
# argon2 cần toolchain để build native binding
# (không còn cần toolchain native sau khi bỏ argon2)

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Client Prisma phải được generate trước khi biên dịch TypeScript
RUN npx prisma generate && npm run build:all && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Không chạy bằng root
USER node
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
# Không EXPOSE/CMD cố định: docker-compose chọn app bằng `command`.
# Một image dùng chung cho cả 9 service — build 1 lần thay vì 9 lần.
CMD ["node", "dist/apps/core-service/main.js"]
