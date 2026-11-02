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

## Philosophy

BanviewR drives the firewall of the machines it manages. Every design choice follows from that.
- **Private by design.** Your data stays on your machines, in a local SQLite database. No cloud, no account with us, no subscription, no telemetry. BanviewR contacts no third-party service by default: anything that has to reach outside (blocklist downloads, IP information, webhooks) stays off until you turn it on, and says what it sends and where.
- **Safe by default.** The server listens on loopback only, there is no default password, passwords are hashed with argon2id, and sessions and API tokens are stored as hashes only. A route that does not declare its access level is admin only: forgetting fails closed, not open.
- **Least privilege.** `viewer` accounts and `read` tokens can look but never change anything, whether from the UI, the API or MCP. A token can be limited to some fail2ban instances.
- **The host's fail2ban comes first.** When fail2ban is already installed on a machine, BanviewR drives it and never starts its own. The embedded fail2ban is only offered where none exists, and the two never run at the same time.
- **One API for everyone.** The web UI, scripts and AI agents (MCP) use the same API, with the same permissions and the same audit log. Nothing is UI only.
- **Multi-instance from day one.** Every piece of data belongs to a fail2ban instance, even when there is only one, so several instances per machine and several machines need no rewrite.
- **Traceable.** Every change (ban, unban, jail, user, token) is written to an audit log: who, what, on which instance, when, from which IP, and whether it worked.
- **Explicit errors.** Every response has the same shape, errors carry a stable code (`VALIDATION`, `FORBIDDEN`, `LOCKED`...) and never leak internal details.
- **Typed end to end.** Each route declares one schema, shared by the server and the web app. Invalid input is rejected at the edge.
- **Light and self-contained.** One container, SQLite, no external database, no chart library: graphs are hand-written SVG.
- **Bilingual.** English and French UI.

## Status

v0.1: instances, jails, ban and unban, history and stats, map, notifications, firewall audit, blocklists, MCP and Docker work.
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

## Install with Docker

External mode: BanviewR drives the fail2ban already installed on the machine (socket, database and configuration mounted from the host).

```bash
git clone https://github.com/Erreur32/BanviewR.git && cd BanviewR
docker compose up -d          # pulls ghcr.io/erreur32/banviewr:latest
# or build the image from this folder: docker compose up -d --build
```

Each release `vX.Y.Z` publishes the image for amd64 and arm64, tagged `X.Y.Z`, `X.Y` and `latest`. Pin a version in `docker-compose.yml` to upgrade only when you choose.

Then open `http://127.0.0.1:3025` on that machine and create the first admin account. The container uses the host network and listens on `127.0.0.1` only: put a reverse proxy with HTTPS in front of it to reach it from elsewhere, or set `HOST` in `docker-compose.yml` at your own risk. Data (database, GeoIP files) lives in `./data`.

The container runs as root, because fail2ban's socket is root-only. It never starts a fail2ban server of its own.

The firewall audit reads the host firewall (`iptables-save`, `ipset list`, `nft list ruleset`), which needs the `NET_ADMIN` capability set in `docker-compose.yml`. That capability would also let the container change the host firewall; access to fail2ban's socket already allows as much, since fail2ban runs its actions as root. Blocklists use the same capability to write their ipset and iptables DROP rule on the host. Remove `cap_add` to drop the audit and blocklists, the rest keeps working.

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

| Variable           | Default                              | Use                                                            |
| ------------------ | ------------------------------------ | -------------------------------------------------------------- |
| `PORT`             | `3025`                               | Server port                                                    |
| `HOST`             | `127.0.0.1`                          | Server bind address                                            |
| `VITE_PORT`        | `5185`                               | Web dev server port                                            |
| `TRUST_PROXY`      | `loopback`                           | Proxies trusted for `X-Forwarded-*` headers (client IP, HTTPS) |
| `DATA_DIR`         | `./data`                             | SQLite database (`banviewr.db`)                                |
| `F2B_SOCKET`       | `/var/run/fail2ban/fail2ban.sock`    | Local fail2ban socket, seeds the first host                    |
| `F2B_DB`           | `/var/lib/fail2ban/fail2ban.sqlite3` | Local fail2ban database, seeds the first host                  |
| `F2B_CONF`         | `/etc/fail2ban`                      | Local fail2ban configuration folder, seeds the first host      |
| `MCP_WRITE`        | `false`                              | Shows the MCP write tools (ban, unban, jail actions)           |
| `BAN_HISTORY_DAYS` | `365`                                | Days of ban history kept, `0` keeps it forever                 |

Other commands:

```bash
npm run test:run   # Vitest, single run
npm run lint       # Biome lint + format check
npm run db:generate  # Create a migration after editing server/db/schema.ts
npx tsc            # Type check
```

## API access

The web UI uses a session cookie. Scripts and AI agents use an API token created by an admin in the UI:

```bash
curl -H "Authorization: Bearer bvr_..." http://127.0.0.1:3025/api/auth/status
```

Tokens carry scopes (`read`, `write`, `admin`) and can be limited to some fail2ban instances.

## MCP

AI agents reach BanviewR with an API token, with the same scopes, instance limits and audit log as the API.
- **HTTP:** `POST /api/mcp` (Streamable HTTP, stateless), header `Authorization: Bearer <token>`
- **stdio:** `BANVIEWR_TOKEN=<token> npx tsx server/mcp/stdio.ts`, from the BanviewR folder with the same environment as the server

Read tools (`read` scope): `list_instances`, `list_jails`, `active_bans`, `ban_history`, `ban_stats`, `active_threats`, `firewall_audit`, and the `banviewr://threats` resource.

Write tools (`write` scope): `ban`, `unban`, `jail_action`. They are hidden unless `MCP_WRITE=true`. An agent cannot ban private, local or link-local addresses, nor an address a user is signed in from; these refusals go to the audit log. There is still no human approval step: give it a `write` token only if you accept that it can ban public addresses on its own.

## Privacy

BanviewR is self-hosted and local only. There is no cloud service behind it, no subscription and no telemetry. Banned addresses, logs, accounts and the audit log never leave your machines unless you enable a feature that sends them: notifications go only to the webhook, Discord, Telegram or MQTT destinations an admin creates, and carry the banned address, its country, the jail and the instance name. Country and operator of an address come from local GeoIP databases; the DB-IP download is optional and started by hand. Blocklists an admin turns on are downloaded from their URL then and every 6 hours: the site serving a list sees your server's address, nothing else is sent. Neither carries ban data. Ban history (addresses, jails, dates) is copied to BanviewR's local database and kept 365 days by default (`BAN_HISTORY_DAYS`), or until the instance is removed.

## Security note

BanviewR drives the host firewall through fail2ban. Keep the server bound to loopback and put the UI behind a reverse proxy with authentication when it is exposed.
