# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @gasman/api --workspace @gasman/shared --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @gasman/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/src/db/migrations ./dist/migrations
# runtime image: minimal manifest (the shared package is bundled into dist, it is not on npm)
RUN echo '{"name":"gasman-api-runtime","private":true,"type":"module"}' > package.json
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts bcryptjs compression cookie-parser cors dotenv express express-rate-limit helmet jsonwebtoken pg pg-hstore pino pino-http sequelize zod
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/server.js"]
