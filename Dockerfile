# BanviewR, external mode: drives the host's fail2ban through its socket and database.
# Embedded mode (v0.2, in progress): runs its own fail2ban-server when the host has none.
# Debian trixie ships fail2ban 1.1, the client must speak the same protocol as the host server.

FROM node:22-trixie AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The built web app is the same on every platform: built natively, not under emulation
FROM --platform=$BUILDPLATFORM node:22-trixie AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-trixie-slim
# External mode uses fail2ban-client only. fail2ban-server runs only in embedded mode, started from
# the UI when EMBEDDED_ALLOWED=true. iptables, ipset and nftables read the firewall for the audit.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fail2ban iptables ipset nftables \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists
WORKDIR /app
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3025 DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=web /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
VOLUME /data
EXPOSE 3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
