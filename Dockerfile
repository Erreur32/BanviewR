# BanviewR, external mode: drives the host's fail2ban through its socket and database.
# Debian trixie ships fail2ban 1.1, the client must speak the same protocol as the host server.

FROM node:26-trixie AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The built web app is the same on every platform: built natively, not under emulation
FROM --platform=$BUILDPLATFORM node:26-trixie AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-trixie-slim
# Only fail2ban-client is used, the server is never started in this image.
# iptables, ipset and nftables only read the host firewall for the audit.
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
