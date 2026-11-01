# Changelog

All notable changes to BanviewR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Statistics page: totals, bans per day and per hour in your time zone, most banned addresses, busiest jails, per instance and period. Works while fail2ban is down.
- API for each instance: jails with their status, ban and unban (IP or network), jail start, stop and reload, active and recent bans, ban statistics. Every action goes to the audit log, failed ones included.
- Web app: first admin setup page, sign-in page, app layout with sidebar (stacked on phones), user name, role and sign-out in the header.
- Preferences page: language (French or English), time zone with a live preview, password change.
- Notifications (toasts) for saved changes; an expired session sends you back to the sign-in page with a message.
- Admin pages: users (create, change role, reset password, delete), API tokens (create with scopes and expiry, secret shown once with a copy button, revoke, then delete), audit log (most recent first, load more).
- Interactive API documentation at `/api/docs/` (Swagger UI), linked from the sidebar, for signed-in users and `read` tokens.

### For developers

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
