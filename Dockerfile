FROM node:20-slim AS builder

# Instala OpenSSL para o Prisma funcionar no Linux
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Instala dependências e gera o Prisma Client
RUN npm install
RUN npx prisma generate

COPY . .
RUN npm run build

FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /usr/src/app/dist ./dist
# Copia a pasta prisma (com schema e migrations) e o client gerado
COPY --from=builder /usr/src/app/prisma ./prisma
# Copia o client gerado também para onde o código compilado espera encontrá-lo
COPY --from=builder /usr/src/app/prisma/generated ./dist/prisma/generated
COPY --from=builder /usr/src/app/prisma.config.ts ./

EXPOSE 3332
CMD ["npm", "run", "start"]