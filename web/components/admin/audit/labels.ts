import type { AuditEntry, AuditModule } from "../types";

export const MODULE_TONE: Record<AuditModule, string> = {
  attendance: "ok",
  payroll: "pending",
  admin: "admin",
};

const ACTION_WORDS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  rename: "Renamed",
  deactivate: "Deactivated",
  activate: "Activated",
  reset_password: "Password reset for",
  mark: "Marked",
  pay: "Paid",
  advance: "Advance given",
  revise: "Revised",
  import: "Imported",
  login_failed: "Failed sign-in for",
};

/** "Updated settings", "Deactivated user" - the human line for an entry. */
export function actionLabel(entry: AuditEntry): string {
  const verb = ACTION_WORDS[entry.action] ?? entry.action.replace(/_/g, " ");
  return `${verb} ${entry.entity.replace(/_/g, " ")}`;
}
