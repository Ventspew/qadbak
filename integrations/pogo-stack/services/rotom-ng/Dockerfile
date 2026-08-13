FROM node:22-bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/UnownHash/RotomNG.git .
RUN npm ci && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/config ./config

EXPOSE 7070 7071
CMD ["node", "dist/packages/server/main.js"]
