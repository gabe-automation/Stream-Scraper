import { pgTable, text, boolean, real, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contentTypeEnum = pgEnum("content_type", ["movie", "tv"]);

export const watchRoomsTable = pgTable("watch_rooms", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  name: text("name").notNull(),
  contentType: contentTypeEnum("content_type").notNull(),
  contentId: text("content_id").notNull(),
  contentTitle: text("content_title").notNull(),
  contentPoster: text("content_poster"),
  hostId: text("host_id").notNull(), // userId
  hostName: text("host_name").notNull(),
  currentTime: real("current_time").notNull().default(0),
  isPlaying: boolean("is_playing").notNull().default(false),
  season: integer("season"),
  episode: integer("episode"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWatchRoomSchema = createInsertSchema(watchRoomsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWatchRoom = z.infer<typeof insertWatchRoomSchema>;
export type WatchRoom = typeof watchRoomsTable.$inferSelect;
