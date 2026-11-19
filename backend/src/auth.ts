import crypto from "node:crypto";
import type { NextFunction, Response } from "express";
import { db } from "./database";
import type { AuthRequest, AuthUser } from "./types";

const COOKIE_NAME = "approval_session";
const APP_SECRET = process.env.APP_SECRET || "local-development-only";
const SESSION_DURATION = Number(process.env.SESSION_DURATION_SECONDS || 28800);

function sign(value: string): string {
  return crypto.createHmac("sha256", APP_SECRET).update(value).digest("hex");
}

export function createSession(user: AuthUser, res: Response): void {
  const payload = `${user.id}.${Math.floor(Date.now() / 1000) + SESSION_DURATION}`;
  const token = `${payload}.${sign(payload)}`;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION * 1000,
    path: "/"
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ detail: "Authentication required" });
    return;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    res.status(401).json({ detail: "Invalid session" });
    return;
  }

  const [userId, expiresAt, signature] = parts;
  const payload = `${userId}.${expiresAt}`;
  const expected = sign(payload);

  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer) ||
    !Number.isInteger(Number(userId)) ||
    Number(expiresAt) < Math.floor(Date.now() / 1000)
  ) {
    res.status(401).json({ detail: "Session expired or invalid" });
    return;
  }

  const row = db.prepare(
    "SELECT id, name, email, role FROM users WHERE id = ?"
  ).get(Number(userId)) as AuthUser | undefined;

  if (!row) {
    res.status(401).json({ detail: "User not found" });
    return;
  }

  req.user = row;
  next();
}

export function requireApprover(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "APPROVER") {
    res.status(403).json({ detail: "Approver access required" });
    return;
  }
  next();
}
