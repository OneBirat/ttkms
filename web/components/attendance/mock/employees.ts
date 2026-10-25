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

/** Devanagari spellings (payroll's optional employee.name_ne), used by the spoken confirmation. */
const NAMES_NE: Record<string, string> = {
  "Anita Gurung": "अनिता गुरुङ",
  "Ramesh K.C.": "रमेश के.सी.",
  "Dipak Adhikari": "दीपक अधिकारी",
  "Kamala Bhandari": "कमला भण्डारी",
  "Nabin Poudel": "नबिन पौडेल",
  "Sarita Basnet": "सरिता बस्नेत",
  "Gopal Thakuri": "गोपाल ठकुरी",
  "Bikash Shrestha": "बिकास श्रेष्ठ",
  "Gita Magar": "गीता मगर",
  "Hari Bista": "हरि बिष्ट",
  "Laxmi Karki": "लक्ष्मी कार्की",
  "Prakash Rana": "प्रकाश राना",
  "Dil Kumari Rai": "दिलकुमारी राई",
  "Sita Thapa": "सीता थापा",
  "Maya Tamang": "माया तामाङ",
  "Rita Shahi": "रीता शाही",
  "Sunita B.K.": "सुनिता बि.क.",
  "Bimala Oli": "बिमला ओली",
  "Kalpana Sunar": "कल्पना सुनार",
  "Priya Rai": "प्रिया राई",
  "Suman Tamang": "सुमन तामाङ",
  "Aarati Joshi": "आरती जोशी",
  "Kiran Lama": "किरण लामा",
  "Rajesh Pandey": "राजेश पाण्डे",
  "Sabina Khadka": "सबिना खड्का",
  "Manoj Dahal": "मनोज दाहाल",
  "Asmita Ghimire": "अस्मिता घिमिरे",
  "Bishal Neupane": "बिशाल न्यौपाने",
};

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
        name_ne: NAMES_NE[name] ?? null,
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

/**
 * Departments with headcount, optionally restricted to one branch. `departments` is the real
 * core list (departments.ts); the headcount joins the mock employees on department_id.
 */
export function departmentRefs(
  branchId: number | null = null,
  departments: readonly { id: number; name: string }[] = DEPARTMENTS,
): DepartmentRef[] {
  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    headcount: EMPLOYEES.filter(
      (e) => e.department_id === d.id && (branchId === null || e.branch_id === branchId),
    ).length,
  }));
}
