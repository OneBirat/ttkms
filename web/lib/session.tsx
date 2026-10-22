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
  type RegistryResponse,
  type Today,
  type User,
} from "@/lib/api";

export interface Session {
  user: User | null;
  modules: Module[];
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
  // The registry and today's date are nice-to-have: the shell still renders
  // without them.
  const registry = apiFetch<RegistryResponse>("/api/registry", { signal }).catch(
    () => null,
  );
  const today = apiFetch<Today>("/api/today", { signal }).catch(() => null);
  const [meBody, registryBody, todayBody] = await Promise.all([
    me,
    registry,
    today,
  ]);
  return {
    user: meBody.user,
    modules: registryBody?.modules ?? [],
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
      router.push("/login");
    }
  }, [router]);

  const value = useMemo<Session>(
    () => ({ user, modules, today, loading, error, refresh, logout }),
    [user, modules, today, loading, error, refresh, logout],
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
