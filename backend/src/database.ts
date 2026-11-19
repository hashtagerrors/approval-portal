import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const databasePath = path.resolve(__dirname, "../approval_portal.db");

export const db = new Database(databasePath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export function initializeDatabase(): void {
  const schemaPath = path.resolve(__dirname, "../schema.sql");
  try {
    if (fs.existsSync(schemaPath)) {
      db.exec(fs.readFileSync(schemaPath, "utf8"));
    }
  } catch (error) {
    console.error("Database schema initialization failed:", error);
    throw error;
  }
}
