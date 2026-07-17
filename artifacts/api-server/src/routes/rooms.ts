import { Router } from "express";
import { db, watchRoomsTable, roomMessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireApproved, type AuthRequest } from "../middlewares/auth";
import { getIO } from "../socket";

const router = Router();

function serializeRoom(
  room: typeof watchRoomsTable.$inferSelect,
  memberCount = 0,
) {
  return {
    id: room.id,
    name: room.name,
    contentType: room.contentType,
    contentId: room.contentId,
    contentTitle: room.contentTitle,
    contentPoster: room.contentPoster ?? null,
    hostId: room.hostId,
    hostName: room.hostName,
    memberCount,
    currentTime: room.currentTime,
    isPlaying: room.isPlaying,
    season: room.season ?? null,
    episode: room.episode ?? null,
    createdAt: room.createdAt.toISOString(),
  };
}

// GET /api/rooms
router.get("/", requireAuth, requireApproved, async (_req, res) => {
  const rooms = await db
    .select()
    .from(watchRoomsTable)
    .orderBy(desc(watchRoomsTable.createdAt));

  res.json(rooms.map((r) => serializeRoom(r)));
});

// POST /api/rooms
router.post("/", requireAuth, requireApproved, async (req: AuthRequest, res) => {
  const { name, contentType, contentId, contentTitle, contentPoster, season, episode } =
    req.body;

  if (!name || !contentType || !contentId || !contentTitle) {
    res.status(400).json({ error: "name, contentType, contentId, contentTitle are required" });
    return;
  }

  const [room] = await db
    .insert(watchRoomsTable)
    .values({
      id: crypto.randomUUID(),
      name,
      contentType,
      contentId: String(contentId),
      contentTitle,
      contentPoster: contentPoster ?? null,
      hostId: req.dbUser!.id,
      hostName: req.dbUser!.name,
      currentTime: 0,
      isPlaying: false,
      season: season ?? null,
      episode: episode ?? null,
    })
    .returning();

  res.status(201).json(serializeRoom(room));
});

// GET /api/rooms/:id
router.get("/:id", requireAuth, requireApproved, async (req, res) => {
  const roomId = String(req.params.id);
  const room = await db.query.watchRoomsTable.findFirst({
    where: eq(watchRoomsTable.id, roomId),
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.json(serializeRoom(room));
});

// DELETE /api/rooms/:id
router.delete("/:id", requireAuth, requireApproved, async (req: AuthRequest, res) => {
  const roomId = String(req.params.id);
  const room = await db.query.watchRoomsTable.findFirst({
    where: eq(watchRoomsTable.id, roomId),
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (room.hostId !== req.dbUser!.id && req.dbUser!.role !== "admin") {
    res.status(403).json({ error: "Only the host or an admin can close a room" });
    return;
  }

  await db.delete(watchRoomsTable).where(eq(watchRoomsTable.id, roomId));

  // Notify all room members in real time so they get redirected immediately
  const io = getIO();
  if (io) io.to(roomId).emit("room-closed", { roomId });

  res.json({ message: "Room closed" });
});

// GET /api/rooms/:id/messages
router.get("/:id/messages", requireAuth, requireApproved, async (req, res) => {
  const roomId = String(req.params.id);
  const messages = await db
    .select()
    .from(roomMessagesTable)
    .where(eq(roomMessagesTable.roomId, roomId))
    .orderBy(desc(roomMessagesTable.createdAt))
    .limit(100);

  res.json(
    messages.reverse().map((m) => ({
      id: m.id,
      roomId: m.roomId,
      userId: m.userId,
      userName: m.userName,
      userAvatar: m.userAvatar ?? null,
      content: m.content,
      type: m.type,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

export default router;
