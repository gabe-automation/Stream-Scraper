import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AuthRequest extends Request {
  dbUser?: typeof usersTable.$inferSelect;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // JIT provision user if they don't exist yet
  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, auth.userId),
  });

  if (!user) {
    // Auto-create user record on first API call
    const clerkUser = auth.sessionClaims as Record<string, unknown>;
    const email =
      (clerkUser?.email as string) ||
      `${auth.userId}@streamvault.local`;
    const name = (clerkUser?.name as string) || email.split("@")[0];
    const avatarUrl = (clerkUser?.picture as string) || null;

    const [created] = await db
      .insert(usersTable)
      .values({
        id: crypto.randomUUID(),
        clerkId: auth.userId,
        email,
        name,
        avatarUrl,
        role: "user",
        isApproved: false,
      })
      .returning();
    user = created;
  }

  req.dbUser = user;
  next();
};

export const requireApproved = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.dbUser?.isApproved) {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }
  next();
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (req.dbUser?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
};
