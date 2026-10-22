/**
 * MOCK core data (branches, departments, employees) in the shape of the core
 * tables. Next session these come from core.* through the attendance API.
 */

import type { BranchRef, DepartmentRef, EmployeeRef } from "../types";

export const BRANCHES: { id: number; name: string }[] = [
  { id: 1, name: "Main branch" },
  { id: 2, name: "Branch 2" },
];

export const DEPARTMENTS: { id: number; name: string }[] = [
  { id: 1, name: "Store" },
  { id: 2, name: "Kitchen" },
  { id: 3, name: "Housekeeping" },
  { id: 4, name: "Front desk" },
  { id: 5, name: "Accounts" },
];

const NAMES_BY_DEPARTMENT: [number, string[]][] = [
  [1, ["Anita Gurung", "Ramesh K.C.", "Dipak Adhikari", "Kamala Bhandari", "Nabin Poudel", "Sarita Basnet", "Gopal Thakuri"]],
  [2, ["Bikash Shrestha", "Gita Magar", "Hari Bista", "Laxmi Karki", "Prakash Rana", "Dil Kumari Rai"]],
  [3, ["Sita Thapa", "Maya Tamang", "Rita Shahi", "Sunita B.K.", "Bimala Oli", "Kalpana Sunar"]],
  [4, ["Priya Rai", "Suman Tamang", "Aarati Joshi", "Kiran Lama"]],
  [5, ["Rajesh Pandey", "Sabina Khadka", "Manoj Dahal", "Asmita Ghimire", "Bishal Neupane"]],
];

function build(): EmployeeRef[] {
  const list: EmployeeRef[] = [];
  for (const [departmentId, names] of NAMES_BY_DEPARTMENT) {
    for (const name of names) {
      const i = list.length;
      const branch = BRANCHES[i % 3 === 2 ? 1 : 0];
      const department = DEPARTMENTS.find((d) => d.id === departmentId)!;
      list.push({
        id: i + 1,
        code: `E-${String(i + 1).padStart(3, "0")}`,
        name,
        branch_id: branch.id,
        branch_name: branch.name,
        department_id: department.id,
        department_name: department.name,
      });
    }
  }
  return list;
}

export const EMPLOYEES: readonly EmployeeRef[] = build();

export function branchRefs(): BranchRef[] {
  return BRANCHES.map((b) => ({
    ...b,
    headcount: EMPLOYEES.filter((e) => e.branch_id === b.id).length,
  }));
}

/** Departments with headcount, optionally restricted to one branch. */
export function departmentRefs(branchId: number | null = null): DepartmentRef[] {
  return DEPARTMENTS.map((d) => ({
    ...d,
    headcount: EMPLOYEES.filter(
      (e) => e.department_id === d.id && (branchId === null || e.branch_id === branchId),
    ).length,
  }));
}
