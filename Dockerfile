FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# Remove as dependências de desenvolvimento reaproveitando o client já gerado.
# `npm ci --omit=dev` apagaria node_modules inteiro, incluindo o client.
RUN npm prune --omit=dev

# O @prisma/client 7 declara a CLI do Prisma e o TypeScript como peer
# dependencies, então o npm as instala e o prune não as remove — arrastando
# studio-core, engines de desenvolvimento e o compilador para a imagem final.
# Nada disso roda em produção: o client já foi gerado acima.
RUN rm -rf \
      node_modules/prisma \
      node_modules/typescript \
      node_modules/@prisma/studio-core \
      node_modules/@prisma/dev \
      node_modules/.bin/prisma \
      node_modules/.bin/tsc \
      node_modules/.bin/tsserver

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./

# Traz node_modules já podado e com o client do Prisma gerado. Instalar aqui
# de novo arrastaria a CLI do Prisma (studio-core, engines de dev, typescript)
# e triplicaria o tamanho da imagem.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Migrations viajam com a imagem para que `prisma migrate deploy` possa rodar
# a partir dela num job de deploy.
COPY --from=builder /app/prisma ./prisma

# Não rodar como root: se a aplicação for comprometida, o atacante não começa
# com privilégio total dentro do container.
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
