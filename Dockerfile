# Includes the October 2026 Node.js security fixes.
FROM node:22.23.4-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY . .

RUN npm run build -w @scenic-route/web

ENV NODE_ENV=production
ENV PORT=8790
EXPOSE 8790

CMD ["node", "--import", "tsx", "apps/api/src/runtime.ts"]
