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

    // ─── Join room ──────────────────────────────────────────────────────────
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
        members.set(userId, {
          userId,
          userName,
          userAvatar: userAvatar ?? null,
          socketId: socket.id,
        });

        socket.data.roomId = roomId;
        socket.data.userId = userId;
        socket.data.userName = userName;

        // Notify existing members of new joiner
        socket.to(roomId).emit("user-joined", { userId, userName });

        // Send full member list to the new joiner
        const memberList = Array.from(members.values()).map((m) => ({
          id: m.userId,
          name: m.userName,
          userAvatar: m.userAvatar,
        }));
        // Include who is currently on a call so Gabriel can see it immediately
        const currentCallers = roomCallState.has(roomId)
          ? Array.from(roomCallState.get(roomId)!.entries()).map(([id, name]) => ({ id, name }))
          : [];
        socket.emit("room-state", { members: memberList, callers: currentCallers });

        // System message
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
          logger.error({ err }, "Failed to save join message");
        }

        logger.info({ roomId, userId, userName }, "User joined room");
      },
    );

    // ─── Sync countdown relay ───────────────────────────────────────────────
    // Host emits this; server relays to all room members (including host)
    socket.on(
      "sync-countdown",
      ({ roomId, seconds }: { roomId: string; seconds: number }) => {
        io.to(roomId).emit("sync-countdown", { seconds });
      },
    );

    // ─── Host action relay ──────────────────────────────────────────────────
    // Used for server selection changes; relayed to all non-host members
    socket.on(
      "host-action",
      ({ roomId, action }: { roomId: string; action: unknown }) => {
        socket.to(roomId).emit("host-action", action);
      },
    );

    // ─── WebRTC call signaling ──────────────────────────────────────────────
    // Emitted when a user joins the call; server replies with current callers,
    // then broadcasts call-joined so existing callers can open a peer connection.
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
        if (!roomCallState.has(roomId)) roomCallState.set(roomId, new Map());
        const callers = roomCallState.get(roomId)!;

        // Reply to new caller with everyone already in the call (excluding themselves)
        const existingCallers = Array.from(callers.entries())
          .filter(([id]) => id !== userId)
          .map(([id, name]) => ({ id, name }));
        socket.emit("call-state", { callers: existingCallers });

        // Register this user
        callers.set(userId, userName);

        // Tell existing callers to open a peer connection
        socket.to(roomId).emit("call-joined", { userId, userName });

        logger.info({ roomId, userId }, "User joined call");
      },
    );

    socket.on(
      "call-left",
      ({ roomId, userId }: { roomId: string; userId: string }) => {
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
            content,
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
        const members = roomMembers.get(roomId);
        if (members) {
          const target = members.get(to);
          if (target) {
            io.to(target.socketId).emit("webrtc-signal", {
              from,
              fromName,
              signal,
            });
          }
        }
      },
    );

    // ─── Disconnect ──────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      const { roomId, userId, userName } = socket.data;
      if (roomId && userId) {
        // Remove from call state and notify peers
        if (roomCallState.get(roomId)?.has(userId)) {
          roomCallState.get(roomId)!.delete(userId);
          io.to(roomId).emit("call-left", { userId });
        }

        // Remove from room members
        const members = roomMembers.get(roomId);
        if (members) {
          members.delete(userId);
          if (members.size === 0) roomMembers.delete(roomId);
        }

        socket.to(roomId).emit("user-left", { userId, userName });

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
          logger.error({ err }, "Failed to save leave message");
        }
      }

      logger.info({ socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}
