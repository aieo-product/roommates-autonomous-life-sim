import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gameSessions = sqliteTable("game_sessions", {
  sessionId: text("session_id").primaryKey(),
  state: text("state").notNull(),
  dbVersion: integer("db_version").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
