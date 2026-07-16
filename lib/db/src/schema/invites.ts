import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invitesTable = pgTable("invites", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  code: text("code").notNull().unique(),
  email: text("email"),
  note: text("note"),
  createdBy: text("created_by").notNull(), // userId
  usedBy: text("used_by"),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInviteSchema = createInsertSchema(invitesTable).omit({
  id: true,
  createdAt: true,
  usedAt: true,
  usedBy: true,
});
export type InsertInvite = z.infer<typeof insertInviteSchema>;
export type Invite = typeof invitesTable.$inferSelect;
