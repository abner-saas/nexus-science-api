import type { userRoleEnum } from "../db/schema.js";

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
  studentId?: string | null;
};

export type AuthenticatedUser = JwtPayload & {
  name: string;
  active: boolean;
};
