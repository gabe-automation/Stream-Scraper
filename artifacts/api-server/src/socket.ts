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

// In-memory room playback state (authoritative from host)
const roomPlayState = new Map<
  string,
  { isPlaying: boolean; currentTime: number; updatedAt: number; hostUserId: string | null }
>();

export function setupSocket(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    path: "/ws/socket.io",
    cors: { origin: "*", credentials: true },
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket connected");

    // ── join-room ──────────────────────────────────────────────────────────
    socket.on(
      "join-room",
      async ({
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
        socket.join(roomId);

        if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Map());
        const members = roomMembers.get(roomId)!;
        members.set(userId, { userId, userName, userAvatar: userAvatar ?? null, socketId: socket.id });

        socket.data.roomId = roomId;
        socket.data.userId = userId;
        socket.data.userName = userName;

        // Tell others someone joined
        socket.to(roomId).emit("user-joined", {
          userId,
          userName,
          userAvatar: userAvatar ?? null,
        });

        // Send full member list + current play state to the new joiner
        const memberList = Array.from(members.values()).map((m) => ({
          userId: m.userId,
          userName: m.userName,
          userAvatar: m.userAvatar,
          socketId: m.socketId,
        }));
        const playState = roomPlayState.get(roomId) ?? {
          isPlaying: false,
          currentTime: 0,
          updatedAt: Date.now(),
          hostUserId: null,
        };
        socket.emit("room-state", { members: memberList, playState });

        // Persist join message
        try {
          await db.insert(roomMessagesTable).values({
            roomId,
            userId,
            userName,
            content: `${userName} joined the room`,
            type: "system",
          });
        } catch (err) {
          logger.error({ err }, "Failed to save join message");
        }
      },
    );

    // ── sync-state (host → everyone) ───────────────────────────────────────
    socket.on(
      "sync-state",
      ({
        roomId,
        isPlaying,
        currentTime,
        hostUserId,
      }: {
        roomId: string;
        isPlaying: boolean;
        currentTime: number;
        hostUserId: string;
      }) => {
        roomPlayState.set(roomId, {
          isPlaying,
          currentTime,
          updatedAt: Date.now(),
          hostUserId,
        });
        socket.to(roomId).emit("sync-state", { isPlaying, currentTime });
      },
    );

    // ── request-sync (late joiner asks for current state) ──────────────────
    socket.on(
      "request-sync",
      ({ roomId, userId }: { roomId: string; userId: string }) => {
        const state = roomPlayState.get(roomId);
        if (!state) return;

        // Estimate drift
        const elapsed = (Date.now() - state.updatedAt) / 1000;
        const estimatedTime = state.isPlaying
          ? state.currentTime + elapsed
          : state.currentTime;

        socket.emit("sync-state", {
          isPlaying: state.isPlaying,
          currentTime: estimatedTime,
        });
      },
    );

    // ── start-countdown (host initiates 3-2-1 GO) ─────────────────────────
    socket.on(
      "start-countdown",
      ({
        roomId,
        atTime,
        seconds = 5,
      }: {
        roomId: string;
        atTime: number;
        seconds?: number;
      }) => {
        io.to(roomId).emit("start-countdown", { atTime, seconds });
      },
    );

    // ── sync-point (host sets a manual sync timestamp) ─────────────────────
    socket.on(
      "sync-point",
      ({
        roomId,
        currentTime,
        label,
      }: {
        roomId: string;
        currentTime: number;
        label?: string;
      }) => {
        roomPlayState.set(roomId, {
          isPlaying: false,
          currentTime,
          updatedAt: Date.now(),
          hostUserId: socket.data.userId ?? null,
        });
        io.to(roomId).emit("sync-point", { currentTime, label });
      },
    );

    // ── chat-message ───────────────────────────────────────────────────────
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
        const messageId = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        const msg = {
          id: messageId,
          roomId,
          userId,
          userName,
          userAvatar: userAvatar ?? null,
          content,
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
            userAvatar: userAvatar ?? null,
            content,
            type: "text",
          });
        } catch (err) {
          logger.error({ err }, "Failed to save chat message");
        }
      },
    );

    // ── typing indicator ───────────────────────────────────────────────────
    socket.on(
      "typing",
      ({ roomId, userId, userName }: { roomId: string; userId: string; userName: string }) => {
        socket.to(roomId).emit("typing", { userId, userName });
      },
    );

    // ── reaction ───────────────────────────────────────────────────────────
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
        io.to(roomId).emit("reaction", { userId, userName, emoji });
      },
    );

    // ── peer-signal (WebRTC) ───────────────────────────────────────────────
    socket.on(
      "peer-signal",
      ({ roomId, to, from, signal }: { roomId: string; to: string; from: string; signal: unknown }) => {
        const members = roomMembers.get(roomId);
        if (members) {
          const target = members.get(to);
          if (target) io.to(target.socketId).emit("peer-signal", { from, signal });
        }
      },
    );

    // ── room-closed (host ends room) ───────────────────────────────────────
    socket.on("room-closed", ({ roomId }: { roomId: string }) => {
      socket.to(roomId).emit("room-closed");
    });

    // ── disconnect ────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      const { roomId, userId, userName } = socket.data;
      if (roomId && userId) {
        const members = roomMembers.get(roomId);
        // Only process if the member was still tracked (prevent double-disconnect)
        if (members?.has(userId)) {
          members.delete(userId);
          if (members.size === 0) roomMembers.delete(roomId);

          socket.to(roomId).emit("user-left", { userId, userName });

          try {
            await db.insert(roomMessagesTable).values({
              roomId,
              userId,
              userName: userName ?? "Unknown",
              content: `${userName ?? "Someone"} left the room`,
              type: "system",
            });
          } catch (err) {
            logger.error({ err }, "Failed to save leave message");
          }
        }
      }
      logger.info({ socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}
