FROM node:22.23.3-bookworm-slim AS build
ARG EPGSTATION_REF=v2.10.0
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN git clone --depth 1 --branch "${EPGSTATION_REF}" https://github.com/l3tnun/EPGStation.git .
COPY dependencies/package.json dependencies/package-lock.json ./
COPY dependencies/client-package.json ./client/package.json
COPY dependencies/client-package-lock.json ./client/package-lock.json
RUN npm ci --ignore-scripts \
    && npm rebuild sqlite3 diskusage-ng --build-from-source \
    && cd client && npm ci --ignore-scripts
COPY update-dependencies.cjs /tmp/update-dependencies.cjs
RUN node /tmp/update-dependencies.cjs \
    && npm run compile && npm run build-client \
    && for file in config/*.template; do cp "$file" "${file%.template}"; done \
    && mkdir -p thumbnail logs streams /recorded
RUN for file in config/*LogConfig.sample.yml; do cp "$file" "${file%.sample.yml}.yml"; done
RUN npm prune --omit=dev --ignore-scripts \
    && npm audit --omit=dev --audit-level=low \
    && rm -rf client/node_modules .git

FROM node:22.23.3-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
COPY notify.cjs /app/notify.cjs
COPY calendar.cjs /app/calendar.cjs
EXPOSE 8888
CMD ["npm", "start"]
