FROM node:22.13-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.server.json ./
COPY src ./src
COPY data ./data
RUN npm run build:server

FROM node:22.13-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/data ./data
EXPOSE 8080
USER node
CMD ["node", "dist/server/index.js"]
