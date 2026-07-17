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
- TMDB token must be read per-request inside `tmdb()`, NOT as a module-level const — the module loads before the secret is in `process.env` after a cold start.

## Real-time push (system-wide)
- `socket.ts` has an `identify` event: client emits its Clerk ID → server does `socket.join("user:<clerkId>")`.
- Routes emit to `user:<clerkId>` for targeted user events, and broadcast for list changes.
- `useSystemSocket` hook (`src/hooks/useSystemSocket.ts`) manages a singleton socket, wired in `App.tsx` via `<SystemSocketBridge />`.
- Events: `user-updated` → refetch /me, `user-deleted` → sign out, `admin-users-changed` → refetch /api/users, `rooms-list-changed` → refetch /api/rooms.

## Presence / chat join-leave design
- Join/leave system messages are NOT persisted to DB — they are ephemeral socket events only.
- Server (`socket.ts`) has an 8-second grace period on disconnect: if the same user rejoins within 8s, the leave is cancelled silently (no broadcast). This absorbs Clerk auth refreshes and network blips.
- Client (`WatchRoomPage.tsx`) generates transient system chat bubbles from `user-joined`/`user-left` socket events — they appear in chat but are never loaded from DB history.

**Why:** Without this, every Clerk token refresh caused a disconnect+reconnect cycle → "X joined / X left / X joined" spam in chat and DB bloat.

## Call UI
- Floating PiP panel: stacked 180px-wide tiles (112px tall each), bottom-right corner.
- In-call sidebar controls: mic/cam toggles + Leave button (replaces the Voice/Video join buttons).
- Media access errors shown inline (not alert()) — `mediaError` state, dismissable.

## RoomsPage delete
- Delete button is a hover-reveal trash icon overlaid on the card (top-right), visible only to the room host.
- Card outer is now a `<div>` wrapping a `<Link>` so the delete `<button>` can sit outside the link without nesting interactive elements.
