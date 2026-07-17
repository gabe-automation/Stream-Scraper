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
- Content: TMDB API for metadata; 9 embed servers listed in `artifacts/streamvault/src/lib/servers.ts`

## Bootstrap admin
`ADMIN_EMAIL` env var — first sign-in with this email gets role=admin + isApproved=true automatically in `auth.ts` requireAuth middleware.

## Critical workflow: after schema changes
1. `pnpm --filter @workspace/db run push` — push schema to DB
2. `pnpm run typecheck:libs` — rebuild lib TS declarations (required before api-server typecheck)
3. Restart `artifacts/api-server: API Server` workflow

## Drizzle / Express 5 params gotcha
`req.params.id` is typed `string | string[]` in Express 5 types. Always cast: `const id = String(req.params.id)` before passing to `eq()`.

**Why:** drizzle-orm's `eq()` overloads don't accept `string[]`, and Express 5 types are broader than Express 4.

## isHost check — MUST use DB user ID
WatchRoomPage checks `isHost` by comparing `me.id` (from `useGetMe()` = DB UUID) with `room.hostId` (DB UUID).
Do NOT use `user.id` from Clerk — that's the Clerk ID, different from the DB UUID.
**Why:** room.hostId is the UUID from our PostgreSQL users table; Clerk user.id is like `user_3Ga8...`.

## Embed / proxy
- All 9 servers in `artifacts/streamvault/src/lib/servers.ts`; shared by VideoPlayer + WatchRoomPage
- All embeds routed through `/api/proxy/embed?url=` for ad stripping + error handling
- Proxy has a 5-second fetch timeout; on failure returns HTML error page that postMessages `{ __sv_error: true, event: 'server-unavailable' }` to parent
- VideoPlayer and WatchRoomPage both listen for this postMessage and auto-advance to the next server
- Servers reachable from Replit's server env (as of July 2026): vidsrc.to ✓, vidsrc.me ✓, multiembed.mov ✓, 2embed.cc ✓
- Servers unreachable (DNS blocked): autoembed.cc ✗, embed.su ✗, vidsrc.icu ✗

## Watch Together sync architecture
Pragmatic approach (no direct iframe video control — players use nested cross-origin iframes):
- Host has a `syncTime` counter that ticks when `isPlaying=true`
- Host broadcasts `sync-state` (isPlaying + currentTime) to all guests via socket
- Host can send `sync-point` (manual seek notification → all guests see a "Seek to X:XX" banner)
- Host can start a 5-second `start-countdown` → all clients show countdown overlay then start together
- Guests receive `sync-state` on join (server estimates drift-corrected time from `roomPlayState` map)
- Socket server tracks play state in-memory `roomPlayState` map per roomId
- Disconnect deduplication: only emit user-left if userId still in `roomMembers` map

## Sound effects
`artifacts/streamvault/src/lib/sounds.ts` — Discord-style sounds generated via Web Audio API, no files needed.
Functions: `playJoinSound`, `playLeaveSound`, `playMessageSound`, `playReactionSound`, `playTickSound`, `playGoSound`, `playSyncSound`
