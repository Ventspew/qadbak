FROM docker:27-cli

RUN apk add --no-cache bash curl

COPY houndour-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV ROTOM_URL=ws://rotom:7070
ENV CHECK_INTERVAL=120
ENV REDROID_CONTAINERS=pogo-stack-redroid-1-1 pogo-stack-redroid-2-1

ENTRYPOINT ["/entrypoint.sh"]
