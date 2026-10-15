# Ambiente de desenvolvimento local: wrangler dev com D1 e R2 emulados (Miniflare).
# workerd precisa de glibc, por isso bookworm-slim em vez de alpine.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8787

# Aplica as migrations no D1 local e sobe o worker acessível fora do container.
CMD ["sh", "-c", "npx wrangler d1 migrations apply florai --local && npx wrangler dev --ip 0.0.0.0 --port 8787"]
