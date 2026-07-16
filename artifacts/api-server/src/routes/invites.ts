import { Router } from "express";
import { db, invitesTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";

const router = Router();

function serializeInvite(inv: typeof invitesTable.$inferSelect) {
  return {
    id: inv.id,
    code: inv.code,
    email: inv.email ?? null,
    note: inv.note ?? null,
    createdBy: inv.createdBy,
    usedBy: inv.usedBy ?? null,
    usedAt: inv.usedAt?.toISOString() ?? null,
    expiresAt: inv.expiresAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}

function generateCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// GET /api/invites — admin only
router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const invites = await db
    .select()
    .from(invitesTable)
    .orderBy(desc(invitesTable.createdAt));

  res.json(invites.map(serializeInvite));
});

// POST /api/invites — admin only
router.post("/", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { email, note, expiresAt } = req.body;

  const [invite] = await db
    .insert(invitesTable)
    .values({
      id: crypto.randomUUID(),
      code: generateCode(),
      email: email ?? null,
      note: note ?? null,
      createdBy: req.dbUser!.id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  res.status(201).json(serializeInvite(invite));
});

// GET /api/invites/:code — check validity
router.get("/:code", async (req, res) => {
  const invite = await db.query.invitesTable.findFirst({
    where: eq(invitesTable.code, String(req.params.code)),
  });

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  res.json(serializeInvite(invite));
});

// DELETE /api/invites/:code — admin only
router.delete("/:code", requireAuth, requireAdmin, async (_req, res) => {
  const code = String(_req.params.code);

  const [deleted] = await db
    .delete(invitesTable)
    .where(eq(invitesTable.code, code))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  res.json({ message: "Invite revoked" });
});

// POST /api/invites/:code/accept
router.post("/:code/accept", requireAuth, async (req: AuthRequest, res) => {
  const invite = await db.query.invitesTable.findFirst({
    where: eq(invitesTable.code, String(req.params.code)),
  });

  if (!invite) {
    res.status(400).json({ error: "Invalid invite code" });
    return;
  }

  if (invite.usedBy) {
    res.status(400).json({ error: "Invite already used" });
    return;
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    res.status(400).json({ error: "Invite has expired" });
    return;
  }

  // Mark invite as used and approve the user
  await db
    .update(invitesTable)
    .set({ usedBy: req.dbUser!.id, usedAt: new Date() })
    .where(eq(invitesTable.id, invite.id));

  const [updatedUser] = await db
    .update(usersTable)
    .set({ isApproved: true })
    .where(eq(usersTable.id, req.dbUser!.id))
    .returning();

  res.json({
    id: updatedUser.id,
    clerkId: updatedUser.clerkId,
    email: updatedUser.email,
    name: updatedUser.name,
    avatarUrl: updatedUser.avatarUrl ?? null,
    role: updatedUser.role,
    isApproved: updatedUser.isApproved,
    createdAt: updatedUser.createdAt.toISOString(),
  });
});

export default router;
