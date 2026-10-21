# Changelog

All notable changes to BanviewR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### For developers

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
