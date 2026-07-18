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

## WebRTC call reliability — critical design rules

**Root cause of "both sides non-initiator" bug:** When a user's Clerk JWT expires mid-call, their socket reconnects. The server removes them from `roomCallState` on disconnect (intentional — call peers need to know immediately). Their client preserves `inCall=true` but their call state is gone server-side. When the other user joins the call they get `call-state: []` (empty), so they create NO peer. The first user receives `call-joined` and creates a peer, but if their userId > the joiner's userId (string comparison), they create a non-initiator peer. Both sides end up non-initiator → no signals → no connection.

**Fixes applied:**
1. `socket "connect"` handler now emits `identify` (joins `user:<id>` room) then checks `inCallRef.current`; if true, destroys stale peers and re-emits `call-joined` to get fresh `call-state`.
2. `leaveCall` sets `inCallRef.current = false` synchronously (before cleanup) so reconnect logic doesn't re-announce an intentional leave.
3. `destroyPeerConnection` deletes the peer from `peersRef.current` BEFORE calling `peer.destroy()` — prevents the close-event destroy loop.
4. Server `webrtc-signal` routes via `io.to(\`user:${to}\`)` (personal identify room) instead of stored `socketId`, which can be momentarily stale during reconnect.
5. 20s ICE connection timeout per peer — if `peer.on("connect")` never fires, the peer is torn down.

**Initiator selection:** lower userId string wins (`A.id < B.id`). Applied consistently in both `call-joined` and `call-state` handlers. The `webrtc-signal` fallback handler (`if (!conn) create non-initiator`) is correct — if we receive a signal without a peer, the sender is the initiator.

## Call UI
- Floating PiP panel: stacked 180px-wide tiles (112px tall each), bottom-right corner.
- In-call sidebar controls: mic/cam toggles + Leave button (replaces the Voice/Video join buttons).
- Media access errors shown inline (not alert()) — `mediaError` state, dismissable.

## RoomsPage delete
- Delete button is a hover-reveal trash icon overlaid on the card (top-right), visible only to the room host.
- Card outer is now a `<div>` wrapping a `<Link>` so the delete `<button>` can sit outside the link without nesting interactive elements.
