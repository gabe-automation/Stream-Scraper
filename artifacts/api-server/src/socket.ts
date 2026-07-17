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

export function setupSocket(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    path: "/ws/socket.io",
    cors: {
      origin: "*",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket connected");

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

        // Store in socket data for cleanup
        socket.data.roomId = roomId;
        socket.data.userId = userId;
        socket.data.userName = userName;

        // Notify room of new member
        socket.to(roomId).emit("user-joined", { userId, userName });

        // Send current member list to new joiner
        const memberList = Array.from(members.values()).map((m) => ({
          userId: m.userId,
          userName: m.userName,
          userAvatar: m.userAvatar,
        }));
        socket.emit("room-state", { members: memberList });

        // Save system message
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

        logger.info({ roomId, userId, userName }, "User joined room");
      },
    );

    socket.on(
      "sync-state",
      ({
        roomId,
        isPlaying,
        currentTime,
      }: {
        roomId: string;
        isPlaying: boolean;
        currentTime: number;
      }) => {
        // Broadcast sync state to all other room members
        socket.to(roomId).emit("sync-state", { isPlaying, currentTime });
      },
    );

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

        // Persist
        try {
          await db.insert(roomMessagesTable).values({
            id: messageId,
            roomId,
            userId,
            userName,
            content,
            type: "text",
          });
        } catch (err) {
          logger.error({ err }, "Failed to save chat message");
        }
      },
    );

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

    socket.on(
      "peer-signal",
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
        // Forward WebRTC signal to specific peer
        const members = roomMembers.get(roomId);
        if (members) {
          const target = members.get(to);
          if (target) {
            io.to(target.socketId).emit("peer-signal", { from, signal });
          }
        }
      },
    );

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

      logger.info({ socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}
