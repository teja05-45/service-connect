# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Frontend image: Create React App static build served by nginx
# ---------------------------------------------------------------------------

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY public ./public
COPY src ./src

# Baked into the bundle at build time. Must be the browser-visible API origin.
ARG REACT_APP_API_BASE_URL=http://localhost:3001/api/v1
ENV REACT_APP_API_BASE_URL=$REACT_APP_API_BASE_URL

RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
    CMD wget -q --spider http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
