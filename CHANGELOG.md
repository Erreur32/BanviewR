# Changelog

All notable changes to BanviewR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### For users

- Embedded fail2ban, first part of v0.2: when the machine has no fail2ban, an admin can start one inside the BanviewR container from the Instances page, and stop it. It comes back with the container once started, and stops for good when a host fail2ban shows up (never both at once). Its configuration and database live in `DATA_DIR/fail2ban/`, with loopback, private ranges and Docker networks always in `ignoreip`.
- Locked by default: it only starts inside a container and with `EMBEDDED_ALLOWED=true`.
- Dashboard with two modes, switched at the top of the page and remembered in the browser. Simple: a few big figures, latest alerts, bans per day over 7 days, health rings, worst addresses, jails, and a one-word summary. Full: six figures with the trend against the 24 hours before, a threat band (addresses by how often they came back), bans per hour stacked by jail, share per jail, bans per day over 14 days, instances, top addresses, countries and network operators, latest bans.
- Each jail keeps the same color everywhere (sshd and recidive always first), checked for contrast and color blindness.
- Menu in four groups (Monitor, Act, Configure, Administration). The instance is chosen once in the sidebar and stays the same from page to page.
- Statistics page rebuilt: each chart has its own format switch, remembered in the browser. Bans over time per jail (bars, lines, table; per week past 120 days), share of each jail (bars, segment, donut, table), when the attacks hit (week x hour heatmap, 24 h clock, table), where they come from (map, bars, table), a year of bans day by day, top addresses and network operators.
- Addresses page: addresses that came back (banned twice or more in 24 h, 7 or 30 days), ranked by level (low to critical), with jails, first and last ban, whether they are banned now, a filter (address, country, operator, jail) and a shortcut to any address page.
- Live page: running bans read from fail2ban every 5 seconds, merged with the local history, bans per minute over the last hour, new bans since the page opened highlighted, pause button.

### For developers

- `GET /api/embedded`, `POST /api/embedded/start` and `POST /api/embedded/stop`: signed-in admins only (API tokens refused), rate limited, audited.
- `F2B_CLIENT` sets the fail2ban client command.
- `/api/hosts/:hostId/stats`: `slots` are now split per jail (`{ at, jail, bans }`), and a new `orgs` list counts bans per network operator.
- Hand-written chart pieces in `web/components/charts.tsx` (stacked bars with tooltip, donut, ring, bar list, sparkline) and a `Segmented` switch in `web/components/ui.tsx`.
- More chart pieces: `LineChart`, `ShareBar`, `CellGrid` (heatmap and calendar), `Clock`; one sequential ramp shared with the world map. `usePersisted` (`web/persisted.ts`) remembers a choice per browser.
- `/api/hosts/:hostId/threats` rows (and the MCP threats tool) gain `firstBanAt`, the first ban inside the window.
- `npm run dev:embedded -- start|stop|logs`: BanviewR with its embedded fail2ban in a container with its own network namespace, for development. `scripts/dev-f2b-client.sh` lets a dev server on the host reach it without a local fail2ban.

## [0.1.1] - 2026-11-05

### Security

- `@fastify/static` 10.1.10, which brings `glob` 14.0.3 and `minimatch` 11.0.4: fixes the `glob` AbortSignal cancellation bypass (Dependabot alert 1) and the `minimatch` pattern denial of service. `npm audit` now reports no vulnerability.

## [0.1.0] - 2026-11-02

### For users

- Accounts: the first admin is created on first start (no default password), then sign-in with a session cookie valid 7 days, extended while in use.
- Roles: `admin` can change things, `viewer` can only read.
- An account is locked 15 minutes after 5 failed sign-ins (20 per IP address), also after a restart.
- API tokens for scripts and AI agents: scopes `read`, `write` or `admin`, optionally limited to some fail2ban instances (not with `admin`, which is global), optional expiry. The secret is shown once.
- Audit log of sign-ins and changes, with author and IP address.
- Usernames are case-insensitive: `Admin` and `admin` are the same account.
- Deleting an admin, or demoting it to viewer, revokes the API tokens it created.
- Each user picks the time zone used to show dates (default: the browser's).
- fail2ban instances: list with live status (connected and version, unreachable, client missing), add, edit and remove from the new Instances page. Removing an instance never touches fail2ban or its bans.
- Startup check for a fail2ban on the machine (socket, process, systemd service). The result and its reason show on the Instances page and in `/api/health`.
- Jails page: running and stopped jails with their settings, start and stop, ban and unban, reload, current bans, per instance. Banning your own address is refused, and so are very wide networks.
- Privacy promise: data stays local, no cloud, no subscription, no telemetry, nothing sent to a third party by default.
- New logo and favicon: a 3x3 grid with one banned cell and the `[banviewr]` wordmark. The favicon follows the browser's light or dark theme.
- API tokens can be limited to chosen instances from the token form.
- Ban history: every minute BanviewR copies new bans of each instance to its own database, so history survives fail2ban's purge. Stays local, removed with its instance, kept with no time limit for now.
- MCP server for AI agents, over HTTP (`/api/mcp`) and stdio, with API tokens: scopes, instance limits and audit log as in the API. Read tools for instances, jails, bans, history, stats and threats. Write tools stay hidden unless `MCP_WRITE=true`.
- API: `/api/hosts/:hostId/history` to search the ban history, `/api/hosts/:hostId/threats` for addresses banned several times.
- Statistics page: totals, bans per day and per hour in your time zone, most banned addresses, busiest jails, per instance and period. Works while fail2ban is down.
- API for each instance: jails with their status, ban and unban (IP or network), jail start, stop and reload, active and recent bans, ban statistics. Every action goes to the audit log, failed ones included.
- Web app: first admin setup page, sign-in page, app layout with sidebar (stacked on phones), user name, role and sign-out in the header.
- Preferences page: language (French or English), time zone with a live preview, password change.
- Notifications (toasts) for saved changes; an expired session sends you back to the sign-in page with a message.
- Admin pages: users (create, change role, reset password, delete), API tokens (create with scopes and expiry, secret shown once with a copy button, revoke, then delete), audit log (most recent first, load more).
- Interactive API documentation at `/api/docs/` (Swagger UI), linked from the sidebar, for signed-in users and `read` tokens.
- Geolocation from local databases: country and network operator next to banned addresses (Jails and Statistics pages), most banned countries. No address is ever sent to an online service.
- New admin page Geolocation: state of the country and ASN databases, one-click download of DB-IP Lite (CC BY 4.0) from download.db-ip.com, or drop your own `country.mmdb` and `asn.mmdb` (DB-IP Lite or MaxMind GeoLite2) in `data/geoip/`. Nothing is downloaded without that click.
- Ban history is kept 365 days by default, then purged (`BAN_HISTORY_DAYS`, `0` keeps everything): it holds personal data.
- AI agents (MCP) can no longer ban private, local or link-local addresses, networks that contain them, or an address a user is signed in from. Each refusal is written to the audit log.
- Blocklists page: public IPv4 lists (Spamhaus DROP, blocklist.de, CINS Army, GreenSnow, BruteForceBlocker, Tor exit nodes, Data-Shield, or any URL) loaded into an ipset dropped on input by an iptables rule, per instance. Added off; turning one on downloads it, then every 6 hours, and again after a restart of BanviewR (the kernel forgets them on reboot). Private ranges, addresses users are signed in from and networks wider than a /8 are left out. Signed-in admins only, every change in the audit log. Removing an instance removes its lists from the firewall.
- Firewall audit page: compares the bans of each jail with what iptables (nft and legacy), ipset and nftables really hold. Reports bans missing from the firewall, leftover entries, chains or sets no rule uses, ipsets with entries but no rule, and rules pointing to a missing ipset. Read-only, run on demand. Also in the API (`/api/hosts/:hostId/firewall`) and as the MCP tool `firewall_audit`. In Docker it needs the `NET_ADMIN` capability, now set in `docker-compose.yml`.
- Docker image and `docker-compose.yml` for external mode: host network, listens on 127.0.0.1, host fail2ban socket, database and configuration mounted, data in `./data`. The server now serves the built web app in production.
- Dashboard: per instance, its state, bans and addresses over 24 hours, active bans, addresses banned more than once in 24 hours with their origin, and the top countries. Works from BanviewR's history while fail2ban is down.
- MQTT notifications: an `mqtt://` or `mqtts://` (TLS) broker URL whose path is the topic, with optional username and password. Publishes the same JSON as the webhook (MQTT 3.1.1, QoS 0). The credentials are never returned by the API.
- Notifications (new admin page): send new bans and manual actions to a JSON webhook, Discord or Telegram. Off until an admin creates a destination; the page says what leaves the server. New bans are grouped per minute and old bans being imported send nothing. Test button, last send status, enable and disable.
- Address page: click an address on the Jails or Statistics page to see its country and network operator, its current bans (with unban) and its whole ban history, with first and last ban and the jails it hit.
- Errors the server answers (fail2ban down, invalid input) now show at once instead of after several silent retries.
- Ban map on the Statistics page: countries colored by number of bans, hover for details. Drawn by BanviewR itself, no map tiles or outside service.

### For developers

- `npm run release -- <x.y.z|patch|minor|major>`: sets the version in `package.json` and `package-lock.json` and dates the CHANGELOG section.
- A `vX.Y.Z` tag publishes the Docker image to GHCR (amd64 and arm64, workflow `release.yml`). The web app is built once on the runner's platform.

- SonarCloud analysis on pushes to `main` and on pull requests (`sonar-project.properties`, workflow `sonarcloud.yml`), skipped while the `SONAR_TOKEN` secret is not set.

- `SECURITY.md` (private vulnerability reports through GitHub) and `.github/dependabot.yml` (monthly grouped updates for Actions, npm and the Docker base image).

- `server/geoip.ts`: reads `DATA_DIR/geoip/{country,asn}.mmdb` with `mmdb-lib` (new dependency), picks up a new file within a minute without restart. `geo` (`{ country, asn, org }` or `null`) added to bans (`locatedBan`), history, threats and top addresses; `countries` added to ban statistics. Same in the MCP tools.
- `Dockerfile` (Node 22 on Debian trixie, fail2ban 1.1 client only, healthcheck on `/api/health`), CI job building the image (not published). In production the server serves `dist/` with `@fastify/static`, unknown non-API GET paths get `index.html`. CSP without `upgrade-insecure-requests` on the whole app, for plain HTTP on a LAN.
- Table `webhooks` (migration `0006`), `server/notifications.ts` (fire and forget, 10 s timeout, no redirects, errors kept in `last_error` without the URL). Routes `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/:id`, `POST /api/webhooks/:id/test`, signed-in admin only and audited. The URL path and the Telegram token are never returned. Discord messages cannot mention anyone, Telegram messages are plain text.
- `BAN_HISTORY_DAYS` (default 365): old `ban_events` are purged on each sync round, and the sync no longer imports bans older than the limit. `checkAgentBan()` in `server/jailOps.ts` holds the MCP ban rules.
- `GET /api/geoip` (read) and `POST /api/geoip/download` (admin session only, 3 per 10 minutes, audited as `geoip.download`).
- `web/world.json`: country outlines from Natural Earth 1:110m (public domain), built by `scripts/world-map.mjs`, lazy-loaded with the map.
- GitHub Actions CI on pull requests and on main: type check, Biome, tests, `npm audit` (high and above).
- Auth API: `GET /api/auth/status`, `POST /api/auth/setup`, `/login`, `/logout`, `/password`; `GET/POST /api/users`, `PATCH/DELETE /api/users/:id`; `GET/POST /api/tokens`, `POST /api/tokens/:id/revoke`, `DELETE /api/tokens/:id`; `GET /api/audit` (keyset pagination with `before`).
- Access control in one `onRequest` hook (`server/auth/access.ts`): each route declares `config.access` (`public`, `read`, `write`, `admin`), missing means `admin`. `sessionOnly` refuses API tokens. A `:hostId` route parameter is checked against the token's allowed instances.
- Sessions and API tokens stored as SHA-256 hashes only, passwords hashed with argon2id (`@node-rs/argon2`).
- CSRF: `SameSite=Strict` cookie plus an `Origin` check against `Host`/`X-Forwarded-Host` on every non-GET request without a Bearer token (login and setup included). Signing in replaces the session presented with the request.
- OpenAPI 3 document generated from the zod route schemas (`@fastify/swagger`), at `GET /api/docs/json`. Each operation lists its tag, `security` (Bearer and/or session cookie) and `x-access` level.
- Web: `Button` variants, `ConfirmButton` (two-click destructive actions), `Badge`, `Table`, `CheckboxField` in `web/components/ui.tsx`; `useFormatDateTime()` in `web/auth.ts`.
- `@fastify/helmet` security headers, `@fastify/rate-limit` (300/min per IP, 10/min on auth routes).
- New error codes: `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_CREDENTIALS`, `LOCKED`, `RATE_LIMITED`. Routes throw `AppError(code, message)`.
- `TRUST_PROXY` (default `loopback`): trusted proxies for client IP and protocol. The Vite proxy keeps `Host` and adds `X-Forwarded-For`.
- Web: TanStack Router (`web/router.tsx`, guards on `setup`, `login` and the signed-in layout), `api` client throwing `ApiError` with the code, `errorText()` translating error codes, `useCurrentUser()`/`useSignedIn()` in `web/auth.ts`.
- Web: i18next with `web/locales/{fr,en}.json` (French default and fallback, choice kept in the browser), test that both files have the same keys.
- Web: `formatDateTime(iso, timezone, lang)` in `web/dates.ts` for every date shown, Zustand `notificationStore` with `notify()` usable outside React, shared form components in `web/components/ui.tsx`.
- `PATCH /api/auth/preferences` (`timezone`: IANA name or `browser`), `users.timezone` (migration `0002_user_timezone`). Dates stay UTC ISO strings in the API, the web app converts them.
- Tables `api_tokens` and `audit_log` (migration `0001_auth`). Unique index on `lower(username)` (migration `0003_username_nocase`), lookups through `usernameIs()` in `server/db/queries.ts`. 14 auth tests.

- `server/config.ts`: environment validated by zod at startup, clear error and exit on invalid values. New variables `DATA_DIR`, `F2B_SOCKET`, `F2B_DB`.
- SQLite database `DATA_DIR/banviewr.db` with Drizzle ORM (WAL, foreign keys). Migrations in `server/db/migrations` (`npm run db:generate`), applied at startup.
- Tables `hosts` (local host seeded from `F2B_SOCKET`/`F2B_DB`), `users`, `sessions`, `login_attempts`, `settings`.
- `server/test-utils.ts`: in-memory database and app for tests. Tests for migrations and host seeding.
- `drizzle-kit` pulled a vulnerable esbuild, forced to `^0.25.0` through `overrides`.
- MIT license.
- Global error handling: validation errors, malformed JSON, unknown routes and crashes all answer `{ success: true, result: { ok: false, code, error } }` with HTTP 200. Codes `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `INTERNAL` (shared schema `apiErrorResult`). Internal error details are logged, never returned.
- Web `apiGet` throws an `ApiError` carrying the code when the result is `ok: false`.
- Graceful shutdown on `SIGINT`/`SIGTERM`: HTTP server closed, then the database.
- `npm run check`: type check, Biome and tests in one command.

## [0.0.1] - 2026-10-21

### For users

- First page at `http://<host>:5185`: shows whether the server is reachable, its version and uptime, refreshed every 5 seconds.

### For developers

- Project bootstrap, extracted from LogviewR v0.16.0 on a new stack: Fastify 5 + zod, React 19 + Vite, TanStack Query, Tailwind 4, Biome, Vitest.
- `npm run dev`: server with `tsx watch` on `127.0.0.1:3025`, web with Vite HMR on `0.0.0.0:5185`, `/api` proxied to the server.
- `shared/api.ts`: zod schema for the `{ success: true, result }` response format, shared by server and web.
- `GET /api/health`: `{ ok, version, uptime }`, response validated by its schema, kept out of the request log.
- Tailwind 4 theme with the GitHub-dark palette (`bg0`, `bg1`, `bg2`, `border`, `text`, `muted`, `ok`, `danger`).
- First Vitest test: `server/app.test.ts` (health route through `app.inject`).
