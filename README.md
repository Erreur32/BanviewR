# BanviewR

<div align="center">

![BanviewR](https://img.shields.io/badge/BanviewR-0.0.1-111827?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-BOOTSTRAP-374151?style=for-the-badge)
![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=38bdf8)
![Fastify](https://img.shields.io/badge/Fastify-5-111827?style=for-the-badge&logo=fastify&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-111827?style=for-the-badge&logo=typescript&logoColor=60a5fa)

**Web UI for fail2ban: jails, bans, stats, map, firewall audit and MCP server**

</div>

---

## Status

Early bootstrap. The dev stack runs, the fail2ban features are not ported yet.
BanviewR is extracted from [LogviewR](https://github.com/Erreur32/LogviewR) v0.16.0, where the fail2ban part lives today.

## Features (target for v0.1)

- Jails: list, status, start/stop, configuration
- Bans: current and historical bans, manual ban/unban, IP lookup and map
- Stats: ban history synced from `fail2ban.sqlite3`
- Firewall audit: iptables, ipset and nftables rules set by fail2ban
- Notifications: webhooks and MQTT
- MCP server: fail2ban tools for AI agents
- Multi-user auth with brute force protection, English and French UI

## Roadmap

- **v0.1, extraction:** port the fail2ban part of LogviewR, external mode (host fail2ban through its socket and `fail2ban.sqlite3`)
- **v0.2, embedded mode:** the container runs `fail2ban-server` itself when no host socket is found
- **Later, multi-host:** one UI driving several hosts

## Stack

| Layer   | Tools                                                                                |
| ------- | ------------------------------------------------------------------------------------ |
| Server  | Fastify 5, zod (schemas shared with the web app), better-sqlite3 + Drizzle ORM, pino |
| Web     | React 19, Vite, TanStack Query, TanStack Router, Zustand, Tailwind 4, i18next        |
| Tooling | TypeScript, Biome, Vitest                                                            |

Layout: `server/` (API), `web/` (UI), `shared/` (schemas and types used by both).

## Development

Requirements: Node.js 22+.

```bash
npm install
cp .env.example .env     # optional, defaults below
npm run dev
```

| Service          | Address                                | Reload                           |
| ---------------- | -------------------------------------- | -------------------------------- |
| Web (Vite)       | `http://<host>:5185`, all interfaces   | HMR, no page reload              |
| Server (Fastify) | `http://127.0.0.1:3025`, loopback only | restarts on change (`tsx watch`) |

The web dev server proxies `/api` to the server, so only port 5185 needs to be reachable.

| Variable     | Default                              | Use                                           |
| ------------ | ------------------------------------ | --------------------------------------------- |
| `PORT`       | `3025`                               | Server port                                   |
| `HOST`       | `127.0.0.1`                          | Server bind address                           |
| `VITE_PORT`  | `5185`                               | Web dev server port                           |
| `DATA_DIR`   | `./data`                             | SQLite database (`banviewr.db`)               |
| `F2B_SOCKET` | `/var/run/fail2ban/fail2ban.sock`    | Local fail2ban socket, seeds the first host   |
| `F2B_DB`     | `/var/lib/fail2ban/fail2ban.sqlite3` | Local fail2ban database, seeds the first host |

Other commands:

```bash
npm run test:run   # Vitest, single run
npm run lint       # Biome lint + format check
npm run db:generate  # Create a migration after editing server/db/schema.ts
npx tsc            # Type check
```

## Security note

BanviewR drives the host firewall through fail2ban. Keep the server bound to loopback and put the UI behind a reverse proxy with authentication when it is exposed.
