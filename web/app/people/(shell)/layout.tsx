import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SessionProvider } from "@/lib/session";
import styles from "./people.module.css";

/**
 * Same shell as web/app/(app)/layout.tsx: the People pages live under
 * web/app/people (module ownership), so they wrap themselves in the session
 * provider and the sidebar. Under 640px the pages render the phone layout
 * with their own header and drawer, and the shared sidebar is hidden
 * (NEEDS FROM MAIN: a phone drawer in AppShell itself). The phone photo page
 * (../photo) stays outside.
 */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <div className={styles.peopleShell}>
        <AppShell>{children}</AppShell>
      </div>
    </SessionProvider>
  );
}
