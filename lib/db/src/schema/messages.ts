import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messageTypeEnum = pgEnum("message_type", ["text", "reaction", "system"]);

export const roomMessagesTable = pgTable("room_messages", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  roomId: text("room_id").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userAvatar: text("user_avatar"),
  content: text("content").notNull(),
  type: messageTypeEnum("type").notNull().default("text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRoomMessageSchema = createInsertSchema(roomMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRoomMessage = z.infer<typeof insertRoomMessageSchema>;
export type RoomMessage = typeof roomMessagesTable.$inferSelect;
