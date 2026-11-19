import "dotenv/config";
import crypto from "node:crypto";
import { db, initializeDatabase } from "./database";

initializeDatabase();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 600_000, 32, "sha256");
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (name, email, password_hash, role)
   VALUES (?, ?, ?, ?)`
);

insertUser.run("Demo User", "user@example.com", hashPassword("UserDemo123!"), "USER");
insertUser.run("User A", "approver@example.com", hashPassword("ApproverDemo123!"), "APPROVER");

const insertProject = db.prepare(
  `INSERT INTO projects (name, description)
   SELECT ?, ?
   WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = ?)`
);

insertProject.run("Vendor Onboarding", "Register and approve a new vendor.", "Vendor Onboarding");
insertProject.run("New Product Launch", "Review and approve a new product launch.", "New Product Launch");
insertProject.run("Contract Renewal", "Review and approve a contract renewal.", "Contract Renewal");

console.log("Seed data checked. Existing users and projects were preserved.");
db.close();
