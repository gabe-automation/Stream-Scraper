# StreamVault

A private, invite-only streaming web app — like Netflix but exclusive. Members stream movies and TV shows, watch together in real-time synchronized rooms, and chat live.

## Architecture

- **Frontend** (`artifacts/streamvault`): React + Vite, Clerk auth, Socket.io client, simple-peer (WebRTC)
- **API server** (`artifacts/api-server`): Express 5, Clerk middleware, Socket.io, Drizzle ORM + PostgreSQL
- **Shared DB** (`lib/db`): Drizzle schema — users, invites, watch_rooms, room_messages

## Key features

- Invite-only access: admin creates invite codes, users redeem them to gain access
- Content via TMDB API (metadata + posters) + vidsrc.to (video embeds)
- Watch Together: synchronized playback via Socket.io, live chat, emoji reactions, WebRTC voice/video via simple-peer
- Admin panel: manage users (approve/promote/remove) and invite codes

## Environment variables / secrets required

| Key | Purpose |
|-----|---------|
| `CLERK_SECRET_KEY` | Clerk auth (backend) — auto-set by Replit |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk auth (frontend) — auto-set by Replit |
| `TMDB_API_KEY` | The Movie Database API key for content metadata |
| `ADMIN_EMAIL` | Email address that gets auto-promoted to admin on first sign-in |
| `DATABASE_URL` | PostgreSQL connection — auto-set by Replit |

## Bootstrap: creating the first admin

Set the `ADMIN_EMAIL` environment variable to your email address. The first time you sign in with that email, your account will be automatically approved and given the admin role. From there you can create invite codes for other users via the Admin panel.

## Development

```bash
# Push schema changes to DB
pnpm --filter @workspace/db run push

# Rebuild lib type declarations after schema changes
pnpm run typecheck:libs

# Typecheck API server
pnpm --filter @workspace/api-server run typecheck
```

## User preferences

- Invite-only model: no self-registration; admin creates invite codes
- vidsrc.to for video embeds (no local video storage)
- Watch Together: Socket.io sync + WebRTC via simple-peer
