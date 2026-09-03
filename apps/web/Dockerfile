# Built from the repo root: the app imports @powerbia/contracts from the workspace.
#   docker build -f apps/web/Dockerfile --target runtime .
FROM node:24-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@powerbia/web", "dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter @powerbia/contracts build && pnpm --filter @powerbia/web build

FROM nginx:1.29-alpine AS runtime
# Substitute only API_URL; nginx's own $host and $uri must survive envsubst.
ENV NGINX_ENVSUBST_FILTER=API_
ENV API_URL=http://api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
