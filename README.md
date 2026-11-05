# BanviewR

<div align="center">

![BanviewR](https://img.shields.io/badge/BanviewR-0.5.0-111827?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-BETA%2C%20active%20development-d97706?style=for-the-badge)
![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=38bdf8)
![Fastify](https://img.shields.io/badge/Fastify-5-111827?style=for-the-badge&logo=fastify&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-111827?style=for-the-badge&logo=typescript&logoColor=60a5fa)

**Web UI for fail2ban: jails, bans, stats, map, firewall audit and MCP server**

</div>

> [!WARNING]
> ## 🚧 BETA, in active development
>
> BanviewR is young and changes fast: features, screens and the API can still change between versions, and bugs are expected.
> It drives your firewall: try it on a test machine first, keep your own way into the server (console, out-of-band access), and read the [CHANGELOG](CHANGELOG.md) before each upgrade.
> Feedback and bug reports are welcome in [Issues](https://github.com/Erreur32/BanviewR/issues) and [Discussions](https://github.com/Erreur32/BanviewR/discussions).

---

## Philosophy

BanviewR drives the firewall of the machines it manages. Every design choice follows from that.
- **Private by design.** Your data stays on your machines, in a local SQLite database. No cloud, no account with us, no subscription, no telemetry. BanviewR contacts no third-party service by default: anything that has to reach outside (blocklist downloads, IP information, webhooks) stays off until you turn it on, and says what it sends and where.
- **Safe by default.** The server listens on loopback only, there is no default password, passwords are hashed with argon2id, and sessions and API tokens are stored as hashes only. A route that does not declare its access level is admin only: forgetting fails closed, not open.
- **Least privilege.** Three roles: `viewer` looks, `operator` also bans, unbans and drives jails, `admin` also manages the app. `read` tokens can look but never change anything, whether from the API or MCP, and a token can be limited to some fail2ban instances. Accounts and tokens are managed from a signed-in session only, never with a token.
- **The host's fail2ban comes first.** When fail2ban is already installed on a machine, BanviewR drives it and never starts its own. The embedded fail2ban is only offered where none exists, and the two never run at the same time.
- **One API for everyone.** The web UI, scripts and AI agents (MCP) use the same API, with the same permissions and the same audit log. Nothing is UI only.
- **Multi-instance from day one.** Every piece of data belongs to a fail2ban instance, even when there is only one, so several instances per machine and several machines need no rewrite.
- **Traceable.** Every change (ban, unban, jail, user, token) is written to an audit log: who, what, on which instance, when, from which IP, and whether it worked.
- **Explicit errors.** Every response has the same shape, errors carry a stable code (`VALIDATION`, `FORBIDDEN`, `LOCKED`...) and never leak internal details.
- **Typed end to end.** Each route declares one schema, shared by the server and the web app. Invalid input is rejected at the edge.
- **Light and self-contained.** One container, SQLite, no external database, no chart library: graphs are hand-written SVG.
- **Bilingual.** English and French UI.

## Status

v0.2: everything from v0.1 (instances, jails, ban and unban, history, map, notifications, firewall audit, blocklists, MCP, Docker) plus the embedded mode for machines without fail2ban, and new monitoring pages.
BanviewR is extracted from [LogviewR](https://github.com/Erreur32/LogviewR) v0.16.0, where the fail2ban part lives today.

## Features

- Dashboard in two modes: simple (a few big figures, alerts, health) or full (trends, threat levels, charts per jail, top addresses, countries and operators)
- Statistics: bans over time per jail, share of each jail, when the attacks hit (heatmap, 24 h clock), where they come from (map), a year day by day; every chart can switch format (bars, lines, donut, table...)
- Addresses: the ones that came back, ranked from low to critical, with first and last ban
- Live: running bans every 5 seconds, bans per minute over the last hour
- Jails: list, status, start/stop, configuration
- Bans: current and historical bans, manual ban/unban, address page with local GeoIP
- Firewall audit: iptables, ipset and nftables rules set by fail2ban
- Blocklists, notifications (webhook, Discord, Telegram, MQTT), MCP server for AI agents
- Embedded mode: BanviewR runs its own fail2ban where none is installed, in the host firewall and Docker's `DOCKER-USER`
- Multi-user auth with three roles (viewer, operator, admin), password confirmation for sensitive changes, disabled accounts, session list, profile pictures, brute force protection, API tokens, audit log, English and French UI (see [Accounts](#accounts))
- Sidebar menu with foldable groups, badges for what waits (critical addresses, firewall issues, fresh bans), a compact icon rail, and Ctrl K to go to a page or an address

## Roadmap

- **v0.1, extraction:** port the fail2ban part of LogviewR, external mode (host fail2ban through its socket and `fail2ban.sqlite3`)
- **v0.2, embedded mode:** the container runs `fail2ban-server` itself when no host socket is found. Start, stop and status from the Instances page behind the `EMBEDDED_ALLOWED` lock, host firewall backend detection, `DOCKER-USER` for published container ports (see [Embedded mode](#embedded-mode))
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

The container runs as root, because fail2ban's socket is root-only. Without `EMBEDDED_ALLOWED=true` it never starts a fail2ban server of its own.

The firewall audit reads the host firewall (`iptables-save`, `ipset list`, `nft list ruleset`), which needs the `NET_ADMIN` capability set in `docker-compose.yml`. That capability would also let the container change the host firewall; access to fail2ban's socket already allows as much, since fail2ban runs its actions as root. Blocklists use the same capability to write their ipset and iptables DROP rule on the host. Remove `cap_add` to drop the audit and blocklists, the rest keeps working.

## Accounts

- **Roles:** `viewer` looks, `operator` also bans, unbans and drives jails, `admin` also manages the app.
- **Sensitive changes** (create, change or delete an account, create an API token) ask the admin's password again when it was last typed more than 10 minutes ago. They are refused to API tokens.
- **Passwords chosen by an admin** (new account, reset) must be replaced at the first sign-in; nothing else works until then.
- **Disabling** an account signs it out, revokes the tokens it created, and refuses its sign-in until an admin enables it again. Nobody can disable or demote their own account, nor the last enabled admin.
- **Sessions:** each user sees the browsers signed in to their account in Preferences, and signs out the ones they do not recognise.
- **Forgotten password:** there is no mail to send a link. Whoever has a shell on the server sets a one-time password, printed once, to be replaced at the next sign-in:

```bash
docker exec -it banviewr node --import tsx server/cli.ts reset-password <username>
```

## Embedded mode

For a machine **without** fail2ban: BanviewR runs its own `fail2ban-server` inside its container and bans in the host firewall. Never use it next to a host fail2ban (their firewall rules would clash): BanviewR refuses to start it when it finds one, and stops it if one shows up.

```bash
docker compose -f docker-compose.embedded.yml up -d
```

Then open `http://127.0.0.1:3025`, create the first admin and start the embedded fail2ban from the Instances page (it never starts on its own the first time; once started it comes back with the container). What the compose file sets, and why:

| Setting                                  | Why                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `network_mode: host`                     | bans must land in the host firewall, and BanviewR sees the real client addresses                 |
| `cap_add: NET_ADMIN, NET_RAW`            | fail2ban's actions change the firewall                                                           |
| `EMBEDDED_ALLOWED=true`                  | the lock: without it the embedded fail2ban never starts (and never outside a container)          |
| `./data:/data`                           | BanviewR's database, and the embedded fail2ban's config, socket and database in `data/fail2ban/` |
| `/var/log:/var/log:ro`                   | logs the jails read, the systemd journal (`/var/log/journal`) included                           |
| `/etc/machine-id`, `/etc/localtime` (ro) | the journal reader finds the host's journal, syslog dates read in local time                     |
| `/var/run/fail2ban:/var/run/fail2ban:ro` | a host fail2ban that appears opens its socket there: BanviewR then stops its own                 |

**Jails.** Put them in `data/fail2ban/etc/jail.d/*.local`, then restart the embedded fail2ban from the Instances page. The stock `jail.conf`, filters and actions come from the image. No jail is enabled by default: Debian's `defaults-debian.conf` is not used. On Debian 12 and later, sshd logs to the journal only:

```ini
[sshd]
enabled = true
backend = systemd
journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd
```

A volatile journal (`/run/log/journal`, no `/var/log/journal` folder) is not mounted: add `/run/log/journal:/run/log/journal:ro` if the host has no persistent journal.

**Never banned.** Loopback, private and link-local ranges, CGNAT (Tailscale) and the Docker bridge networks up at start are written to `ignoreip` in `jail.d/00-banviewr.local`. A jail that sets its own `ignoreip` replaces that list in fail2ban: BanviewR adds the missing ranges back to every running jail on start, after each jail action from BanviewR, and every minute (`fail2ban-client set <jail> addignoreip`); a jail reloaded outside BanviewR runs up to a minute on its own list.

**Firewall backend.** On each start BanviewR checks which firewall the host uses, from where Docker's rules are: iptables with the nf_tables backend (`iptables-nft`, Debian's default), `iptables-legacy`, or nftables alone. The embedded fail2ban then writes to the same one (its iptables commands call `iptables-legacy` on a legacy host; `banaction = nftables` on a pure nftables host). The Instances page shows what was found.

**Published container ports.** Traffic to a published Docker port goes through `FORWARD`, not `INPUT`, so a ban in `INPUT` alone does not stop it. When Docker's `DOCKER-USER` chain exists, every jail gets a second action, `banviewr-docker-user` (fail2ban's `iptables-allports` on `DOCKER-USER`, chain `f2b-<jail>-du`, written to `action.d/`), on all ports: after Docker's DNAT the port seen there is the container's, not the published one. Both are set in `jail.d/00-banviewr.conf`, which your `jail.local` or `jail.d/*.local` can override. A jail with its own `action =` list adds `%(action_docker)s` to keep it. No other chain is touched.

**Host fail2ban detection.** Inside the container BanviewR sees the host's fail2ban through its socket only (the process and systemd checks cannot see the host). A host fail2ban that starts later is found within a minute; the embedded one stops, stays off, and a notification goes to the destinations that send manual actions. The host's systemd removes and recreates `/run/fail2ban` when its fail2ban stops and starts, which the container's mount no longer follows: BanviewR treats that replaced folder as a host fail2ban too. After removing a host fail2ban, restart the container to check again. A host fail2ban that is installed but never started is not seen.

Limits: IPv6 bans reach `DOCKER-USER` only when Docker manages ip6tables; otherwise they skip it and stay in `INPUT`. Docker's own nftables firewall backend has no `DOCKER-USER` chain.

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
| `F2B_CLIENT`       | `fail2ban-client`                    | Client command used to reach every instance                    |
| `EMBEDDED_ALLOWED` | `false`                              | Allows the embedded fail2ban (only ever inside a container)    |
| `MCP_WRITE`        | `false`                              | Shows the MCP write tools (ban, unban, jail actions)           |
| `BAN_HISTORY_DAYS` | `365`                                | Days of ban history kept, `0` keeps it forever                 |

### Embedded mode in development

The embedded fail2ban only starts inside a container (`/.dockerenv`) with `EMBEDDED_ALLOWED=true`, and never next to a host fail2ban. Never run fail2ban on the development machine itself: use the dev container, which has its own network namespace (`NET_ADMIN` and `NET_RAW`, no host network), so its bans and firewall rules stay inside it.

```bash
npm run dev:embedded -- start   # BanviewR from this checkout, embedded mode allowed, on 127.0.0.1:3027
npm run dev:embedded -- logs
npm run dev:embedded -- stop    # removes the container, data-dev/ is kept
```

Its config and fail2ban database live in `data-dev/fail2ban/`, mounted at the same path inside the container. Start the embedded fail2ban from the Instances page or with `POST /api/embedded/start`; a `manual` jail is added for ban tests. The page served on 3027 is the image's build: for the current UI, run `PORT=3027 VITE_PORT=5186 npx vite`.

The development machine has no `fail2ban-client`. A dev server on the host can still drive that fail2ban with `F2B_CLIENT=./scripts/dev-f2b-client.sh`, which runs the container's client through `docker exec`, and `F2B_SOCKET`, `F2B_DB`, `F2B_CONF` pointing into `data-dev/fail2ban/`.

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
