/** Users & access: the real /api/admin endpoints (app/modules/admin). */

import { apiFetch } from "@/lib/api";
import type {
  AdminUser,
  TemporaryPassword,
  UserCreated,
  UserInput,
  UserOptions,
} from "./types";

export function listUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/api/admin/users");
}

export function userOptions(): Promise<UserOptions> {
  return apiFetch<UserOptions>("/api/admin/users/options");
}

export function createUser(input: UserInput): Promise<UserCreated> {
  return apiFetch<UserCreated>("/api/admin/users", { method: "POST", json: input });
}

export function updateUser(id: number, input: UserInput): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/admin/users/${id}`, { method: "PUT", json: input });
}

export function setUserActive(id: number, is_active: boolean): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/admin/users/${id}/active`, {
    method: "POST",
    json: { is_active },
  });
}

export function resetPassword(id: number): Promise<TemporaryPassword> {
  return apiFetch<TemporaryPassword>(`/api/admin/users/${id}/reset-password`, {
    method: "POST",
  });
}
