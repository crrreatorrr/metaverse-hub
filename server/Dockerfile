FROM node:22-alpine AS build
WORKDIR /src
COPY modules/package.json modules/package-lock.json ./
RUN npm ci
COPY modules/tsconfig.json ./
COPY modules/src ./src
RUN npm run build

FROM registry.heroiclabs.com/heroiclabs/nakama:3.41.0
COPY --from=build /src/build/index.js /nakama/data/modules/index.js
