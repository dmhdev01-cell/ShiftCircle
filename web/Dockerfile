# ShiftCircle web container (docs/08-deployment.md §2).
#
# Stage 1 builds the React app with pnpm, stage 2 serves the static build
# with nginx, which also reverse-proxies /api/ to the api container.

FROM node:24-alpine AS build
WORKDIR /app

# pnpm is pinned through the packageManager field in package.json.
RUN corepack enable

# Dependencies first, so a source change does not reinstall them.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build


FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:80/healthz || exit 1
