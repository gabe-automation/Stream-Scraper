import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { roomMessagesTable } from "@workspace/db";
import crypto from "crypto";

interface RoomMember {
  userId: string;
  userName: string;
  userAvatar: string | null;
  socketId: string;
}

// In-memory room member tracking for WebRTC routing
const roomMembers = new Map<string, Map<string, RoomMember>>();

export function setupSocket(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    path: "/ws/socket.io",
    cors: {
      origin: "*", // In production, restrict this to your actual frontend domain
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket connected");

    // ───────────────────────────────────────────────────────────────
    // 1. JOIN ROOM
    // ───────────────────────────────────────────────────────────────
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

        if (!roomMembers.has(roomId)) {
          roomMembers.set(roomId, new Map());
        }

        const members = roomMembers.get(roomId)!;
        members.set(userId, {
          userId,
          userName,
          userAvatar: userAvatar ?? null,
          socketId: socket.id,
        });

        // Store in socket data for cleanup on disconnect
        socket.data.roomId = roomId;
        socket.data.userId = userId;
        socket.data.userName = userName;

        // Notify room of new member
        socket.to(roomId).emit("user-joined", { userId, userName, userAvatar });

        // Send current member list to new joiner
        const memberList = Array.from(members.values()).map((m) => ({
          id: m.userId,
          name: m.userName,
          userAvatar: m.userAvatar,
        }));
        socket.emit("room-state", { members: memberList });

        // Save & Broadcast System Join Message
        try {
          const sysMsgId = crypto.randomUUID();
          const sysMsgContent = `${userName} joined the room`;

          await db.insert(roomMessagesTable).values({
            id: sysMsgId,
            roomId,
            userId: "system",
            userName: "System",
            content: sysMsgContent,
            type: "system",
          });

          io.to(roomId).emit("chat-message", {
            id: sysMsgId,
            roomId,
            userId: "system",
            userName: "System",
            userAvatar: null,
            content: sysMsgContent,
            type: "system",
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          logger.error({ err }, "Failed to save/broadcast join message");
        }

        logger.info({ roomId, userId, userName }, "User joined room");
      },
    );

    // ───────────────────────────────────────────────────────────────
    // 2. CHAT MESSAGES
    // ───────────────────────────────────────────────────────────────
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

        // Broadcast to all in room (including sender)
        io.to(roomId).emit("chat-message", msg);

        // Persist to Database
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

    // ───────────────────────────────────────────────────────────────
    // 3. REACTIONS
    // ───────────────────────────────────────────────────────────────
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

    // ───────────────────────────────────────────────────────────────
    // 4. WEBRTC SIGNALING (Routes directly to specific peer)
    // ───────────────────────────────────────────────────────────────
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
        const members = roomMembers.get(roomId);
        if (members) {
          const target = members.get(to);
          if (target) {
            // Send signal ONLY to the specific target user's socket
            io.to(target.socketId).emit("webrtc-signal", { from, fromName, signal });
          }
        }
      },
    );

    // ───────────────────────────────────────────────────────────────
    // 5. SYNC COUNTDOWN (Host triggers 5s play timer for everyone)
    // ───────────────────────────────────────────────────────────────
    socket.on(
      "sync-countdown",
      ({ roomId, seconds }: { roomId: string; seconds: number }) => {
        // Broadcast the countdown to everyone in the room
        io.to(roomId).emit("sync-countdown", { seconds });
      }
    );

    // ───────────────────────────────────────────────────────────────
    // 6. DISCONNECT & CLEANUP
    // ───────────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      const { roomId, userId, userName } = socket.data;

      if (roomId && userId) {
        const members = roomMembers.get(roomId);
        if (members) {
          members.delete(userId);
          if (members.size === 0) {
            roomMembers.delete(roomId);
          }
        }

        socket.to(roomId).emit("user-left", { userId, userName });

        // Save & Broadcast System Leave Message
        try {
          const sysMsgId = crypto.randomUUID();
          const sysMsgContent = `${userName ?? "Someone"} left the room`;

          await db.insert(roomMessagesTable).values({
            id: sysMsgId,
            roomId,
            userId: "system",
            userName: "System",
            content: sysMsgContent,
            type: "system",
          });

          io.to(roomId).emit("chat-message", {
            id: sysMsgId,
            roomId,
            userId: "system",
            userName: "System",
            userAvatar: null,
            content: sysMsgContent,
            type: "system",
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          logger.error({ err }, "Failed to save/broadcast leave message");
        }
      }

      logger.info({ socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}