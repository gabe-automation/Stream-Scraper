---
name: StreamVault architecture
description: Key decisions and gotchas for the StreamVault private streaming app
---

## Stack
- Frontend: React+Vite at `artifacts/streamvault` (slug `streamvault`, root path `/`)
- API: Express 5 at `artifacts/api-server` (port 8080, paths `/api` and `/ws`)
- Real-time: Socket.io on `/ws/socket.io`
- Auth: Replit-managed Clerk + Google OAuth. Env: `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`
- DB: PostgreSQL via Drizzle ORM (`lib/db`). Schema: users, invites, watch_rooms, room_messages
- Content: TMDB API for metadata, vidsrc.to for video embeds

## Bootstrap admin
`ADMIN_EMAIL` env var — first sign-in with this email gets role=admin + isApproved=true automatically in `auth.ts` requireAuth middleware.

## Critical workflow: after schema changes
1. `pnpm --filter @workspace/db run push` — push schema to DB
2. `pnpm run typecheck:libs` — rebuild lib TS declarations (required before api-server typecheck)
3. Restart `artifacts/api-server: API Server` workflow

## Drizzle / Express 5 params gotcha
`req.params.id` is typed `string | string[]` in Express 5 types. Always cast: `const id = String(req.params.id)` before passing to `eq()`.

**Why:** drizzle-orm's `eq()` overloads don't accept `string[]`, and Express 5 types are broader than Express 4.

## Content
- TMDB API key stored as secret `TMDB_API_KEY`
- Embed URL pattern: `https://vidsrc.to/embed/movie/{id}` or `.../tv/{id}/{season}/{episode}`
