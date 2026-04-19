FROM maven:3.9.11-eclipse-temurin-17

ARG NODE_VERSION=24.11.1
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH}" in \
    amd64) NODE_ARCH=x64 ;; \
    arm64) NODE_ARCH=arm64 ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
 && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
 && tar -xJf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
 && rm "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
 && node --version \
 && npm --version
