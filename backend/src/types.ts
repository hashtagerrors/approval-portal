import type { Request } from "express";

export type UserRole = "USER" | "APPROVER";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}
