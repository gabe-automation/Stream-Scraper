import type { Request, Response, NextFunction } from "express";
import { getAuth, createClerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AuthRequest extends Request {
  dbUser?: typeof usersTable.$inferSelect;
}

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

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
    // Fetch real user data from Clerk backend API
    const clerkUser = await clerk.users.getUser(auth.userId);
    const email =
      clerkUser.emailAddresses[0]?.emailAddress ||
      `${auth.userId}@streamvault.local`;
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      email.split("@")[0];
    const avatarUrl = clerkUser.imageUrl || null;

    // Bootstrap: if this email matches ADMIN_EMAIL, make them admin + approved
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
    const isBootstrapAdmin =
      !!adminEmail && email.toLowerCase().trim() === adminEmail;

    const [created] = await db
      .insert(usersTable)
      .values({
        id: crypto.randomUUID(),
        clerkId: auth.userId,
        email,
        name,
        avatarUrl,
        role: isBootstrapAdmin ? "admin" : "user",
        isApproved: isBootstrapAdmin ? true : false,
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
