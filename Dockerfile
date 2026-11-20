# Image de production GazFlow (utilisée par Coolify ou « docker compose »).
FROM node:22-alpine

ENV NODE_ENV=production PORT=3000
WORKDIR /app

# Dépendances de production uniquement (la base embarquée de développement n'est pas incluse).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY netlify/database/migrations ./netlify/database/migrations

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/server.js"]
