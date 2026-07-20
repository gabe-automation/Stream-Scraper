import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { roomMessagesTable } from "@workspace/db";

interface RoomMember {
  userId: string;
  userName: string;
  userAvatar: string | null;
  socketId: string;
}

// In-memory room member tracking
const roomMembers = new Map<string, Map<string, RoomMember>>();

// In-memory call state: roomId → Map<userId, userName>
const roomCallState = new Map<string, Map<string, string>>();

// Watch stream state: roomId → hostId (host is actively sharing their screen)
const roomWatchShare = new Map<string, string>();

// Grace-period disconnect timers: "roomId:userId" → timer
// Absorbs quick reconnects (Clerk auth refreshes, network blips) so users
// don't see "X joined / X left / X joined" spam in chat.
const DISCONNECT_GRACE_MS = 8_000;
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Module-level IO reference so routes can emit events
let _io: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return _io;
}

export function setupSocket(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    path: "/ws/socket.io",
    cors: {
      origin: "*",
      credentials: true,
    },
  });

  _io = io;

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket connected");

    // ─── System identify (global per-user room) ──────────────────────────────
    // Client emits this right after connecting so we can target events at them.
    socket.on("identify", (clerkId: string) => {
      if (!clerkId || typeof clerkId !== "string") return;
      const room = `user:${clerkId}`;
      socket.join(room);
      socket.data.clerkId = clerkId;
      logger.debug({ socketId: socket.id, clerkId }, "Socket identified");
    });

    // ─── Join room ──────────────────────────────────────────────────────────
    socket.on(
      "join-room",
      ({
        roomId,
        userId,
        userName,
        userAvatar,
      }: {
        roomId: string;
        userId: string;
        userName: string;
        userAvatar?: string | null;
      }) => {
        if (!roomId || !userId) return;

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.userId = userId;
        socket.data.userName = userName;

        if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Map());
        const members = roomMembers.get(roomId)!;

        const presenceKey = `${roomId}:${userId}`;
        const pendingDisconnect = disconnectTimers.get(presenceKey);

        if (pendingDisconnect !== undefined) {
          // User reconnected within the grace period — cancel the leave timer,
          // update their socket ID silently without broadcasting join/leave.
          clearTimeout(pendingDisconnect);
          disconnectTimers.delete(presenceKey);
          const existing = members.get(userId);
          if (existing) {
            members.set(userId, { ...existing, socketId: socket.id });
          } else {
            members.set(userId, { userId, userName, userAvatar: userAvatar ?? null, socketId: socket.id });
          }
          // Still notify others so their participant lists stay accurate,
          // but mark it silent so clients don't print a chat message.
          socket.to(roomId).emit("user-joined", { userId, userName, silent: true });
          logger.info({ roomId, userId }, "User silently reconnected (within grace period)");
        } else {
          // Genuine new join — add to members and notify the room
          members.set(userId, { userId, userName, userAvatar: userAvatar ?? null, socketId: socket.id });
          socket.to(roomId).emit("user-joined", { userId, userName });
          logger.info({ roomId, userId, userName }, "User joined room");
        }

        // Send full member + caller state + watch share state to the (re)joining socket
        const memberList = Array.from(members.values()).map((m) => ({
          id: m.userId,
          name: m.userName,
          userAvatar: m.userAvatar,
        }));
        const currentCallers = roomCallState.has(roomId)
          ? Array.from(roomCallState.get(roomId)!.entries()).map(([id, name]) => ({ id, name }))
          : [];
        const watchHostId = roomWatchShare.get(roomId);
        const hostSharing = !!watchHostId;
        socket.emit("room-state", { members: memberList, callers: currentCallers, hostSharing });

        // If the host is already sharing and this is a new non-host guest joining,
        // notify the host to open a watch peer connection to this new guest.
        if (watchHostId && userId !== watchHostId && !pendingDisconnect) {
          io.to(`user:${watchHostId}`).emit("watch-guest-joined", { userId });
          logger.debug({ roomId, userId, watchHostId }, "Notified host of new guest for watch stream");
        }
      },
    );

    // ─── Sync countdown relay ───────────────────────────────────────────────
    socket.on(
      "sync-countdown",
      ({ roomId, seconds }: { roomId: string; seconds: number }) => {
        if (!roomId || typeof seconds !== "number") return;
        io.to(roomId).emit("sync-countdown", { seconds });
      },
    );

    // ─── Host action relay ──────────────────────────────────────────────────
    // Used for server-selection changes; relayed to all non-host members.
    socket.on(
      "host-action",
      ({ roomId, action }: { roomId: string; action: unknown }) => {
        if (!roomId) return;
        socket.to(roomId).emit("host-action", action);
      },
    );

    // ─── Watch Stream signaling ─────────────────────────────────────────────
    // Host starts sharing their screen — register and broadcast to guests.
    socket.on(
      "watch-start",
      ({ roomId, userId }: { roomId: string; userId: string }) => {
        if (!roomId || !userId) return;
        roomWatchShare.set(roomId, userId);

        // Tell all guests the host started sharing
        socket.to(roomId).emit("watch-started", { hostId: userId });

        // Reply to host with all current guests so they can open WebRTC peers
        const members = roomMembers.get(roomId);
        const guests = members
          ? Array.from(members.values())
              .filter((m) => m.userId !== userId)
              .map((m) => ({ id: m.userId, name: m.userName }))
          : [];
        socket.emit("watch-guests", { guests });

        logger.info({ roomId, userId, guestCount: guests.length }, "Host started watch share");
      },
    );

    // Host stops sharing.
    socket.on(
      "watch-stop",
      ({ roomId, userId }: { roomId: string; userId: string }) => {
        if (!roomId || !userId) return;
        if (roomWatchShare.get(roomId) === userId) {
          roomWatchShare.delete(roomId);
          io.to(roomId).emit("watch-stopped");
          logger.info({ roomId, userId }, "Host stopped watch share");
        }
      },
    );

    // WebRTC signal for watch stream — route to target user's personal room.
    socket.on(
      "watch-signal",
      ({
        roomId,
        to,
        from,
        signal,
      }: {
        roomId: string;
        to: string;
        from: string;
        signal: unknown;
      }) => {
        if (!roomId || !to || !from) return;
        io.to(`user:${to}`).emit("watch-signal", { from, signal });
      },
    );

    // ─── WebRTC call signaling ──────────────────────────────────────────────
    socket.on(
      "call-joined",
      ({
        roomId,
        userId,
        userName,
      }: {
        roomId: string;
        userId: string;
        userName: string;
      }) => {
        if (!roomId || !userId) return;
        if (!roomCallState.has(roomId)) roomCallState.set(roomId, new Map());
        const callers = roomCallState.get(roomId)!;

        // Reply to new caller with everyone already in the call (excluding themselves)
        const existingCallers = Array.from(callers.entries())
          .filter(([id]) => id !== userId)
          .map(([id, name]) => ({ id, name }));
        socket.emit("call-state", { callers: existingCallers });

        // Register this user and tell others to open a peer connection
        callers.set(userId, userName);
        socket.to(roomId).emit("call-joined", { userId, userName });

        logger.info({ roomId, userId }, "User joined call");
      },
    );

    socket.on(
      "call-left",
      ({ roomId, userId }: { roomId: string; userId: string }) => {
        if (!roomId || !userId) return;
        roomCallState.get(roomId)?.delete(userId);
        socket.to(roomId).emit("call-left", { userId });
        logger.info({ roomId, userId }, "User left call");
      },
    );

    // ─── Chat ───────────────────────────────────────────────────────────────
    socket.on(
      "chat-message",
      async ({
        roomId,
        userId,
        userName,
        userAvatar,
        content,
      }: {
        roomId: string;
        userId: string;
        userName: string;
        userAvatar?: string | null;
        content: string;
      }) => {
        if (!roomId || !userId || !content?.trim()) return;

        const messageId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const msg = {
          id: messageId,
          roomId,
          userId,
          userName,
          userAvatar: userAvatar ?? null,
          content: content.trim(),
          type: "text" as const,
          createdAt,
        };
        io.to(roomId).emit("chat-message", msg);
        try {
          await db.insert(roomMessagesTable).values({
            id: messageId,
            roomId,
            userId,
            userName,
            content: content.trim(),
            type: "text",
          });
        } catch (err) {
          logger.error({ err }, "Failed to save chat message");
        }
      },
    );

    // ─── Reactions ──────────────────────────────────────────────────────────
    socket.on(
      "reaction",
      ({
        roomId,
        userId,
        userName,
        emoji,
      }: {
        roomId: string;
        userId: string;
        userName: string;
        emoji: string;
      }) => {
        if (!roomId || !emoji) return;
        io.to(roomId).emit("reaction", { userId, userName, emoji });
      },
    );

    // ─── WebRTC Signaling ────────────────────────────────────────────────────
    socket.on(
      "webrtc-signal",
      ({
        roomId,
        to,
        from,
        fromName,
        signal,
      }: {
        roomId: string;
        to: string;
        from: string;
        fromName: string;
        signal: unknown;
      }) => {
        if (!roomId || !to || !from) return;
        // Route via the personal `user:<id>` room that each socket joins on
        // "identify". This survives Clerk auth-refresh reconnects where
        // the stored socketId in roomMembers could be momentarily stale.
        io.to(`user:${to}`).emit("webrtc-signal", { from, fromName, signal });
      },
    );

    // ─── Disconnect ──────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      const { roomId, userId, userName } = socket.data as {
        roomId?: string;
        userId?: string;
        userName?: string;
      };
      if (!roomId || !userId) return;

      logger.info({ socketId: socket.id, roomId, userId }, "Socket disconnected — grace period started");

      // Call state: remove immediately (no grace period; call peers need to know now)
      if (roomCallState.get(roomId)?.has(userId)) {
        const current = roomMembers.get(roomId)?.get(userId);
        if (current?.socketId === socket.id) {
          roomCallState.get(roomId)!.delete(userId);
          io.to(roomId).emit("call-left", { userId });
        }
      }

      // Watch share: if host disconnects, immediately stop the share for all guests
      if (roomWatchShare.get(roomId) === userId) {
        const current = roomMembers.get(roomId)?.get(userId);
        if (current?.socketId === socket.id) {
          roomWatchShare.delete(roomId);
          io.to(roomId).emit("watch-stopped");
          logger.info({ roomId, userId }, "Watch share stopped — host disconnected");
        }
      }

      // Presence: defer for DISCONNECT_GRACE_MS to absorb quick reconnects
      const presenceKey = `${roomId}:${userId}`;
      const existing = disconnectTimers.get(presenceKey);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        disconnectTimers.delete(presenceKey);

        // Only act if this socket is still the registered one (they haven't reconnected)
        const members = roomMembers.get(roomId);
        const current = members?.get(userId);
        if (!current || current.socketId !== socket.id) return;

        members!.delete(userId);
        if (members!.size === 0) roomMembers.delete(roomId);

        // Broadcast user-left with userName so clients can show a notification
        io.to(roomId).emit("user-left", { userId, userName: userName ?? "Someone" });
        logger.info({ roomId, userId }, "User left room (grace period elapsed)");
      }, DISCONNECT_GRACE_MS);

      disconnectTimers.set(presenceKey, timer);
    });
  });

  return io;
}
