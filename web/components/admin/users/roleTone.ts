import type { Role } from "../types";

/** Pill tones for the role badge: Admin blue, Manager teal, Staff grey (design colours). */
export const ROLE_TONE: Record<Role, string> = {
  admin: "info",
  manager: "ok",
  staff: "neutral",
};
