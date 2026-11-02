# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Backend image: Express API + PostgreSQL migration runner
# ---------------------------------------------------------------------------

# Dependencies are installed in a builder stage because bcrypt is a native
# module and needs build tooling on Alpine (musl) - the runtime image stays slim.
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# tini reaps child processes and forwards signals (clean shutdown).
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY index.js ./
COPY middleware ./middleware
COPY src ./src
COPY db ./db
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

RUN mkdir -p /app/uploads \
    && chmod +x /app/docker-entrypoint.sh \
    && chown -R node:node /app

USER node
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
