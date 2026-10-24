import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SessionProvider } from "@/lib/session";

/**
 * Same shell as web/app/(app)/layout.tsx: the People pages live under
 * web/app/people (module ownership), so they wrap themselves in the session
 * provider and the sidebar. The phone photo page (../photo) stays outside.
 */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
