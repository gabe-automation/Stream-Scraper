import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";

const router = Router();

// GET /api/users/me
router.get("/me", requireAuth, (req: AuthRequest, res) => {
  const user = req.dbUser!;
  res.json({
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    isApproved: user.isApproved,
    createdAt: user.createdAt.toISOString(),
  });
});

// PATCH /api/users/me
router.patch("/me", requireAuth, async (req: AuthRequest, res) => {
  const { name } = req.body;
  const [updated] = await db
    .update(usersTable)
    .set({ name: name ?? req.dbUser!.name })
    .where(eq(usersTable.id, req.dbUser!.id))
    .returning();

  res.json({
    id: updated.id,
    clerkId: updated.clerkId,
    email: updated.email,
    name: updated.name,
    avatarUrl: updated.avatarUrl ?? null,
    role: updated.role,
    isApproved: updated.isApproved,
    createdAt: updated.createdAt.toISOString(),
  });
});

// GET /api/users — admin only
router.get("/", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const page = parseInt(String(req.query.page ?? "1"), 10);
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 100);
  const offset = (page - 1) * limit;

  const allUsers = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(usersTable);
  const total = count;

  res.json({
    users: allUsers.map((u) => ({
      id: u.id,
      clerkId: u.clerkId,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl ?? null,
      role: u.role,
      isApproved: u.isApproved,
      createdAt: u.createdAt.toISOString(),
    })),
    total,
  });
});

// PATCH /api/users/:id — admin only
router.patch("/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  const { role, isApproved } = req.body;

  const updateData: Record<string, unknown> = {};
  if (role !== undefined) updateData.role = role;
  if (isApproved !== undefined) updateData.isApproved = isApproved;

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id: updated.id,
    clerkId: updated.clerkId,
    email: updated.email,
    name: updated.name,
    avatarUrl: updated.avatarUrl ?? null,
    role: updated.role,
    isApproved: updated.isApproved,
    createdAt: updated.createdAt.toISOString(),
  });
});

// DELETE /api/users/:id — admin only
router.delete("/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = String(req.params.id);

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ message: "User deleted" });
});

export default router;
