import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { db, initializeDatabase } from "./database";
import { authenticate, clearSession, createSession, requireApprover } from "./auth";
import type { AuthRequest, AuthUser } from "./types";

initializeDatabase();

const app = express();
const PORT = Number(process.env.PORT || 8000);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const STORAGE_DIR = path.resolve(__dirname, "../../storage");
const MAX_FILE_SIZE = 10 * 1024 * 1024;

fs.mkdirSync(STORAGE_DIR, { recursive: true });

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

function getUser(req: AuthRequest): AuthUser {
  if (!req.user) throw new Error("Authenticated user missing");
  return req.user;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.pbkdf2Sync(password, salt, 600_000, expected.length, "sha256");

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function recordEvent(instanceId: number, actorId: number, eventType: string): void {
  db.prepare(
    "INSERT INTO workflow_events (instance_id, actor_id, event_type) VALUES (?, ?, ?)"
  ).run(instanceId, actorId, eventType);
}

function getDocuments(instanceId: number) {
  return db.prepare(
    "SELECT id, filename FROM documents WHERE instance_id = ? ORDER BY uploaded_at"
  ).all(instanceId);
}

async function sendSignatureEmail(
  recipient: string,
  projectName: string,
  instanceId: number
): Promise<{ sent: boolean; preview: { to: string; subject: string; body: string } }> {
  const subject = `Signature required: ${projectName}`;
  const body =
    `The project "${projectName}" has been approved and is ready for signature.\n\n` +
    `Please sign in to the Approval Portal to review and sign the document:\n${FRONTEND_URL}\n\n` +
    `Project instance: ${instanceId}`;

  const preview = { to: recipient, subject, body };
  const { SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_FROM) {
    return { sent: false, preview };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD }
    });

    await transporter.sendMail({ from: SMTP_FROM, to: recipient, subject, text: body });
    return { sent: true, preview };
  } catch (error) {
    console.error("Signature email could not be sent:", error);
    return { sent: false, preview };
  }
}

app.get("/", (_req, res) => res.json({ message: "Approval Portal API" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/login", (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ detail: "Email and password are required" });
    return;
  }

  const row = db.prepare(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = ?"
  ).get(email.trim().toLowerCase()) as (AuthUser & { password_hash: string }) | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ detail: "Invalid email or password" });
    return;
  }

  const user: AuthUser = { id: row.id, name: row.name, email: row.email, role: row.role };
  createSession(user, res);
  res.json({ user });
});

app.post("/api/logout", (_req, res) => {
  clearSession(res);
  res.json({ message: "Logged out" });
});

app.get("/api/me", authenticate, (req: AuthRequest, res) => {
  res.json({ user: getUser(req) });
});

app.get("/api/projects", authenticate, (_req, res) => {
  const projects = db.prepare(
    "SELECT id, name, description FROM projects ORDER BY id"
  ).all();
  res.json(projects);
});

app.post("/api/projects/:projectId/start", authenticate, (req: AuthRequest, res) => {
  const user = getUser(req);
  const projectId = Number(req.params.projectId);

  if (!Number.isInteger(projectId)) {
    res.status(400).json({ detail: "Invalid project ID" });
    return;
  }

  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    res.status(404).json({ detail: "Project not found" });
    return;
  }

  const result = db.prepare(
    "INSERT INTO project_instances (project_id, created_by, status) VALUES (?, ?, 'DRAFT')"
  ).run(projectId, user.id);

  const instanceId = Number(result.lastInsertRowid);
  recordEvent(instanceId, user.id, "PROJECT_STARTED");
  res.status(201).json({ id: instanceId, status: "DRAFT" });
});

app.post(
  "/api/projects/instances/:instanceId/documents",
  authenticate,
  upload.single("file"),
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = getUser(req);
      const instanceId = Number(req.params.instanceId);
      const file = req.file;

      if (!file) {
        res.status(400).json({ detail: "A PDF file is required" });
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        res.status(413).json({ detail: "File exceeds the 10 MB limit" });
        return;
      }

      if (file.mimetype !== "application/pdf" || file.buffer.subarray(0, 5).toString() !== "%PDF-") {
        res.status(400).json({ detail: "Only valid PDF files are allowed" });
        return;
      }

      const instance = db.prepare(
        "SELECT id, created_by, status FROM project_instances WHERE id = ?"
      ).get(instanceId) as { id: number; created_by: number; status: string } | undefined;

      if (!instance) {
        res.status(404).json({ detail: "Project instance not found" });
        return;
      }
      if (instance.created_by !== user.id) {
        res.status(403).json({ detail: "Access denied" });
        return;
      }
      if (instance.status !== "DRAFT") {
        res.status(400).json({ detail: "Documents can only be uploaded to draft projects" });
        return;
      }

      const instanceDir = path.join(STORAGE_DIR, String(instanceId));
      fs.mkdirSync(instanceDir, { recursive: true });
      const storedName = `${crypto.randomUUID()}.pdf`;
      const filePath = path.join(instanceDir, storedName);
      fs.writeFileSync(filePath, file.buffer);

      const result = db.prepare(
        `INSERT INTO documents
          (instance_id, filename, file_path, content_type, uploaded_by)
         VALUES (?, ?, ?, ?, ?)`
      ).run(instanceId, file.originalname, filePath, "application/pdf", user.id);

      res.status(201).json({
        id: Number(result.lastInsertRowid),
        filename: file.originalname
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/documents/:documentId/view", authenticate, (req: AuthRequest, res) => {
  const user = getUser(req);
  const documentId = Number(req.params.documentId);

  const document = db.prepare(
    `SELECT d.file_path, d.filename, pi.created_by, pi.status
     FROM documents d
     JOIN project_instances pi ON pi.id = d.instance_id
     WHERE d.id = ?`
  ).get(documentId) as {
    file_path: string;
    filename: string;
    created_by: number;
    status: string;
  } | undefined;

  if (!document) {
    res.status(404).json({ detail: "Document not found" });
    return;
  }

  const isOwner = document.created_by === user.id;
  const canReview =
    user.role === "APPROVER" &&
    ["PENDING_APPROVAL", "PENDING_SIGNATURE", "COMPLETED"].includes(document.status);

  if (!isOwner && !canReview) {
    res.status(403).json({ detail: "Access denied" });
    return;
  }

  if (!fs.existsSync(document.file_path)) {
    res.status(404).json({ detail: "Stored document not found" });
    return;
  }

  res.type("application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(document.filename)}"`);
  res.sendFile(path.resolve(document.file_path));
});

app.post(
  "/api/projects/instances/:instanceId/request-approval",
  authenticate,
  (req: AuthRequest, res) => {
    const user = getUser(req);
    const instanceId = Number(req.params.instanceId);
    const instance = db.prepare(
      "SELECT id, created_by, status FROM project_instances WHERE id = ?"
    ).get(instanceId) as { id: number; created_by: number; status: string } | undefined;

    if (!instance) {
      res.status(404).json({ detail: "Project instance not found" });
      return;
    }
    if (instance.created_by !== user.id) {
      res.status(403).json({ detail: "Access denied" });
      return;
    }
    if (instance.status !== "DRAFT") {
      res.status(400).json({ detail: "Project is not in draft status" });
      return;
    }

    const documentCount = db.prepare(
      "SELECT COUNT(*) AS count FROM documents WHERE instance_id = ?"
    ).get(instanceId) as { count: number };

    if (documentCount.count === 0) {
      res.status(400).json({ detail: "Upload at least one PDF before requesting approval" });
      return;
    }

    db.prepare(
      "UPDATE project_instances SET status = 'PENDING_APPROVAL' WHERE id = ?"
    ).run(instanceId);
    recordEvent(instanceId, user.id, "APPROVAL_REQUESTED");
    res.json({ status: "PENDING_APPROVAL" });
  }
);

app.get("/api/approvals", authenticate, requireApprover, (_req, res) => {
  const rows = db.prepare(
    `SELECT pi.id AS instance_id, p.name AS project_name,
            u.name AS requested_by,
            (SELECT COUNT(*) FROM documents d WHERE d.instance_id = pi.id) AS document_count
     FROM project_instances pi
     JOIN projects p ON p.id = pi.project_id
     JOIN users u ON u.id = pi.created_by
     WHERE pi.status = 'PENDING_APPROVAL'
     ORDER BY pi.created_at`
  ).all() as Array<Record<string, any>>;

  res.json(rows.map((row) => ({
    ...row,
    documents: getDocuments(row.instance_id)
  })));
});

app.post("/api/approvals/:instanceId/approve", authenticate, requireApprover, async (req: AuthRequest, res) => {
  const user = getUser(req);
  const instanceId = Number(req.params.instanceId);

  const instance = db.prepare(
    `SELECT pi.id, pi.status, p.name AS project_name
     FROM project_instances pi
     JOIN projects p ON p.id = pi.project_id
     WHERE pi.id = ?`
  ).get(instanceId) as { id: number; status: string; project_name: string } | undefined;

  if (!instance) {
    res.status(404).json({ detail: "Project instance not found" });
    return;
  }
  if (instance.status !== "PENDING_APPROVAL") {
    res.status(400).json({ detail: "Project is not awaiting approval" });
    return;
  }

  db.prepare(
    `UPDATE project_instances
     SET status = 'PENDING_SIGNATURE', approved_by = ?, approved_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(user.id, instanceId);
  recordEvent(instanceId, user.id, "APPROVED");

  const email = await sendSignatureEmail(user.email, instance.project_name, instanceId);
  recordEvent(instanceId, user.id, email.sent ? "SIGNATURE_EMAIL_SENT" : "SIGNATURE_EMAIL_PREVIEWED");

  res.json({
    email_sent: email.sent,
    email_preview: email.preview
  });
});

app.get("/api/signatures", authenticate, requireApprover, (req: AuthRequest, res) => {
  const user = getUser(req);
  const rows = db.prepare(
    `SELECT pi.id AS instance_id, p.name AS project_name, u.name AS requested_by
     FROM project_instances pi
     JOIN projects p ON p.id = pi.project_id
     JOIN users u ON u.id = pi.created_by
     WHERE pi.status = 'PENDING_SIGNATURE' AND pi.approved_by = ?
     ORDER BY pi.approved_at`
  ).all(user.id) as Array<Record<string, any>>;

  res.json(rows.map((row) => ({
    ...row,
    documents: getDocuments(row.instance_id)
  })));
});

app.post("/api/signatures/:instanceId/sign", authenticate, requireApprover, (req: AuthRequest, res) => {
  const user = getUser(req);
  const instanceId = Number(req.params.instanceId);
  const signerName = String(req.body?.signer_name || "").trim();

  if (!signerName || signerName.toLowerCase() !== user.name.toLowerCase()) {
    res.status(400).json({ detail: "Enter your authenticated name to sign" });
    return;
  }

  const instance = db.prepare(
    "SELECT id, status, approved_by FROM project_instances WHERE id = ?"
  ).get(instanceId) as { id: number; status: string; approved_by: number | null } | undefined;

  if (!instance) {
    res.status(404).json({ detail: "Project instance not found" });
    return;
  }
  if (instance.status !== "PENDING_SIGNATURE" || instance.approved_by !== user.id) {
    res.status(400).json({ detail: "Project is not awaiting your signature" });
    return;
  }

  db.prepare(
    `UPDATE project_instances
     SET status = 'COMPLETED', signed_by = ?, signed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(user.id, instanceId);
  recordEvent(instanceId, user.id, "SIGNED");

  res.json({ status: "COMPLETED" });
});

app.get("/api/completed", authenticate, (req: AuthRequest, res) => {
  const user = getUser(req);
  const filterColumn = user.role === "APPROVER" ? "pi.approved_by" : "pi.created_by";

  const rows = db.prepare(
    `SELECT pi.id AS instance_id, p.name AS project_name,
            u.name AS requester, pi.signed_at
     FROM project_instances pi
     JOIN projects p ON p.id = pi.project_id
     JOIN users u ON u.id = pi.created_by
     WHERE pi.status = 'COMPLETED' AND ${filterColumn} = ?
     ORDER BY pi.signed_at DESC`
  ).all(user.id) as Array<Record<string, any>>;

  res.json(rows.map((row) => ({
    ...row,
    documents: getDocuments(row.instance_id)
  })));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ detail: "File exceeds the 10 MB limit" });
    return;
  }

  console.error(error);
  res.status(500).json({ detail: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Approval Portal API running at http://localhost:${PORT}`);
});
