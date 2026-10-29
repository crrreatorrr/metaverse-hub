FROM node:22-alpine AS build
WORKDIR /src
COPY modules/package.json modules/package-lock.json ./
RUN npm ci
COPY modules/tsconfig.json modules/embed-shop.mjs ./
COPY data/shop_price.peoples-bitcoin.json ./data/shop_price.peoples-bitcoin.json
COPY modules/src ./src
RUN npm run build

FROM heroiclabs/nakama:3.41.0
COPY --from=build /src/build/index.js /nakama/data/modules/index.js
