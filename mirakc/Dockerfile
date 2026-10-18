ARG MIRAKC_IMAGE=mirakc/mirakc:debian
FROM ${MIRAKC_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
