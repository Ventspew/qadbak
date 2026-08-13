FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
RUN git clone --depth 1 https://github.com/WatWowMap/ReactMap.git .

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint.sh"]
