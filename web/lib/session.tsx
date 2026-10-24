"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  apiFetch,
  errorMessage,
  isAbortError,
  setCsrfToken,
  type AuthResponse,
  type Module,
  type ModulesResponse,
  type Today,
  type User,
} from "@/lib/api";
import { modulesFromNav } from "@/lib/modules";

export interface Session {
  user: User | null;
  /** Sidebar sections from /api/core/modules (enabled modules only, role-filtered). */
  modules: Module[];
  /** ENABLED_MODULES as loaded by the backend; a paused module is absent. */
  enabled: string[];
  isEnabled: (name: string) => boolean;
  today: Today | null;
  loading: boolean;
  /** Message when the session could not be loaded (network/server error). */
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

async function loadSession(signal: AbortSignal) {
  const me = apiFetch<AuthResponse>("/api/auth/me", { signal });
  // The module list and today's date are nice-to-have: the shell still renders
  // without them (an empty sidebar, no date line).
  const modules = apiFetch<ModulesResponse>("/api/core/modules", {
    signal,
  }).catch(() => null);
  const today = apiFetch<Today>("/api/today", { signal }).catch(() => null);
  const [meBody, modulesBody, todayBody] = await Promise.all([
    me,
    modules,
    today,
  ]);
  return {
    user: meBody.user,
    modules: modulesFromNav(modulesBody?.nav ?? []),
    enabled: modulesBody?.enabled ?? [],
    today: todayBody,
  };
}

/**
 * Loads the signed-in user, the module registry and today's date once for the
 * app shell. Mount it in the (app) layout; pages read it through useSession().
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [today, setToday] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadSession(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setUser(result.user);
        setModules(result.modules);
        setEnabled(result.enabled);
        setToday(result.today);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        // A 401 has already triggered the redirect to /login in apiFetch.
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  const refresh = useCallback(async () => {
    setAttempt((n) => n + 1);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>("/api/auth/logout", {
        method: "POST",
        redirectOn401: false,
      });
    } catch {
      // The session is gone either way; fall through to the login page.
    } finally {
      setCsrfToken(null);
      setUser(null);
      setModules([]);
      setEnabled([]);
      router.push("/login");
    }
  }, [router]);

  const isEnabled = useCallback(
    (name: string) => enabled.includes(name),
    [enabled],
  );

  const value = useMemo<Session>(
    () => ({
      user,
      modules,
      enabled,
      isEnabled,
      today,
      loading,
      error,
      refresh,
      logout,
    }),
    [user, modules, enabled, isEnabled, today, loading, error, refresh, logout],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return session;
}
