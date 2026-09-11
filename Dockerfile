FROM debian:bookworm-slim AS engine-build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src/PentaZen
COPY PentaZen/CMakeLists.txt PentaZen/public.h ./
COPY PentaZen/src ./src

RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --target PentaZen --parallel 2

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY backend ./backend
COPY frontend ./frontend
COPY wasm ./wasm
COPY --from=engine-build /src/PentaZen/build/src/PentaZen ./PentaZen/PentaZen

RUN chmod 755 ./PentaZen/PentaZen \
    && chown -R node:node /app

USER node
EXPOSE 10000

CMD ["node", "backend/server.js"]
