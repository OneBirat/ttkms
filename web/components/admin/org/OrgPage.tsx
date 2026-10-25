"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { listBranches, listDepartments } from "../api";
import type { PageAccess } from "../permissions";
import { AdminGate } from "../components/AdminGate";
import { Toast, useToast } from "../components/Toast";
import { useLoader } from "../components/useLoader";
import { OrgCard } from "./OrgCard";
import styles from "../components/admin.module.css";

const TITLE = "Branches & departments";
const SUBTITLE = "Where people work. Branches are deactivated, never deleted; a department can be deleted once nobody is in it.";

export function OrgPage() {
  return (
    <AdminGate page="org" title={TITLE} subtitle={SUBTITLE}>
      {(access) => <OrgScreen access={access} />}
    </AdminGate>
  );
}

function OrgScreen({ access }: { access: Exclude<PageAccess, "none"> }) {
  const branches = useLoader(listBranches);
  const departments = useLoader(listDepartments);
  const { toast, show, dismiss } = useToast();

  const changed = (message: string) => {
    show(message);
    branches.reload();
    departments.reload();
  };

  return (
    <div className={styles.stack}>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      {access === "view" ? (
        <p className={`${styles.note} ${styles.accessNote}`} role="note">
          You can view branches and departments. Ask an admin to add or change them.
        </p>
      ) : null}
      <div className={styles.twoUp}>
        <OrgCard
          kind="branch"
          title="Branches"
          note="Shops and stores. Each employee belongs to one branch."
          items={branches.data}
          loading={branches.loading}
          error={branches.error}
          access={access}
          onChanged={changed}
          onRetry={branches.reload}
        />
        <OrgCard
          kind="department"
          title="Departments"
          note="Company-wide teams that group employees and reports. Delete is possible only at 0 employees (former staff count)."
          items={departments.data}
          loading={departments.loading}
          error={departments.error}
          access={access}
          onChanged={changed}
          onRetry={departments.reload}
        />
      </div>
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
