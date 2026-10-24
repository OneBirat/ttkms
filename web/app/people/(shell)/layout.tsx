import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SessionProvider } from "@/lib/session";

/**
 * Same shell as web/app/(app)/layout.tsx: the People pages live under
 * web/app/people (module ownership), so they wrap themselves in the session
 * provider and the shell. Under 640px the screens render their own phone
 * header (PhoneFrame) and open the shell's PhoneDrawer from it. The phone
 * photo page (../photo) stays outside the shell.
 */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
