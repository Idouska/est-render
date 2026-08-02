# Image unique pour les trois processus : API, workers et tâches planifiées.
# La commande de démarrage change, pas l'image — ce qui garantit qu'ils
# tournent tous sur exactement le même code.

FROM node:22-slim AS builder

# Prisma a besoin d'OpenSSL pour détecter la bonne cible de son moteur.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

# On reprend les node_modules du builder plutôt que de réinstaller : le client
# Prisma généré et son moteur natif restent appariés à coup sûr. L'image est
# plus grosse, mais on évite la classe d'erreurs la plus pénible au démarrage.
# Le CLI Prisma est conservé volontairement : il applique les migrations.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
COPY public ./public

# L'application ne doit pas tourner en root.
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
