FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    adb \
    curl \
    jq \
    ca-certificates \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/ ./scripts/
RUN chmod +x ./scripts/*.sh

ENV REDROID_HOSTS=redroid-1:5555,redroid-2:5555
ENV ANDROID_DEVICES=
ENV CONFIG_DIR=/configs
ENV APK_DIR=/apk
ENV PUSH_INTERVAL=60

CMD ["./scripts/entrypoint.sh"]
