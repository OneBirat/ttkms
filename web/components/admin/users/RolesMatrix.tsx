import { ROLES } from "../types";
import {
  accessFor,
  accessLabel,
  accessSymbol,
  AREAS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Access,
} from "../permissions";
import styles from "../components/admin.module.css";

const GROUP_LABELS: Record<string, string> = {
  shared: "General",
  stock: "Stock",
  attendance: "Attendance",
  payroll: "People & payroll",
  admin: "Admin",
};

function cellClass(access: Access): string {
  if (access === "full") return styles.cellFull;
  if (access === "view") return styles.cellView;
  return styles.cellNone;
}

/** Read-only roles × areas matrix so the owner can see what each role can do. */
export function RolesMatrix() {
  const groups = [...new Set(AREAS.map((area) => area.module))];
  return (
    <section className={`card ${styles.cardPad}`} aria-labelledby="roles-matrix-title">
      <div className={styles.cardHead}>
        <div>
          <h2 id="roles-matrix-title" className={styles.cardTitle}>
            Roles &amp; permissions
          </h2>
          <p className={styles.cardNote}>
            What each role can open. ✓ full access · view read-only · — no access. Roles are
            fixed; change a person&apos;s role from the table above.
          </p>
        </div>
      </div>
      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th scope="col">Area</th>
              {ROLES.map((role) => (
                <th key={role} scope="col" title={ROLE_DESCRIPTIONS[role]}>
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <GroupRows key={group} group={group} />
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.diffMeta} style={{ marginTop: 16, marginBottom: 0 }}>
        {ROLES.map((role) => (
          <div key={role} style={{ display: "contents" }}>
            <dt>{ROLE_LABELS[role]}</dt>
            <dd>{ROLE_DESCRIPTIONS[role]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function GroupRows({ group }: { group: string }) {
  const areas = AREAS.filter((area) => area.module === group);
  return (
    <>
      {group !== "shared" ? (
        <tr>
          <th scope="rowgroup" colSpan={ROLES.length + 1} className={styles.matrixGroup}>
            {GROUP_LABELS[group] ?? group}
          </th>
        </tr>
      ) : null}
      {areas.map((area) => (
        <tr key={area.key}>
          <th scope="row" style={{ fontWeight: 500 }}>
            {area.label}
          </th>
          {ROLES.map((role) => {
            const access = accessFor(role, area.key);
            return (
              <td key={role} className={cellClass(access)}>
                <span aria-hidden="true">{accessSymbol(access)}</span>
                <span className="sr-only">
                  {ROLE_LABELS[role]}: {accessLabel(access)}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
