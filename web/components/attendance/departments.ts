/**
 * Departments come from core (GET /api/core/departments, app/core/departments.py) so a
 * department added from /people/employees shows up in Mark attendance and the report at once.
 * Employees are still mock (mock/employees.ts) until the attendance backend lands; their
 * `department_id` matches the seeded core ids. Without a server (node tests, offline dev) the
 * mock list is used so the screens still render.
 */

import { ApiError, apiFetch } from "@/lib/api";
import { DEPARTMENTS } from "./mock/employees";

export interface DepartmentBase {
  id: number;
  name: string;
}

export async function loadDepartments(): Promise<DepartmentBase[]> {
  try {
    const rows = await apiFetch<{ id: number; name: string }[]>("/api/core/departments");
    return rows.map(({ id, name }) => ({ id, name }));
  } catch (err) {
    if (err instanceof ApiError) throw err; // a real answer (401, 403, 500): surface it
    return DEPARTMENTS; // no server reachable: the mock seed (same ids as `make seed`)
  }
}
