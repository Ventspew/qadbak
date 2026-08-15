FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client \
    sshpass \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/ ./scripts/
RUN chmod +x ./scripts/*.sh

ENV IOS_DEVICES=
ENV CONFIG_DIR=/configs
ENV PUSH_INTERVAL=60
ENV IOS_SSH_USER=root

CMD ["./scripts/entrypoint.sh"]
