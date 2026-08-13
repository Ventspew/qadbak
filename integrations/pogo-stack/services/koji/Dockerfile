FROM rust:1.85-bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends git pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/TurtIeSocks/Koji.git .
RUN cargo build --release
RUN ls -la target/release/

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/target/release/ /usr/local/bin/
ENV KOJI_DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 8080
# Koji binary name may vary by release; adjust CMD if needed after first build.
CMD ["koji-server"]
