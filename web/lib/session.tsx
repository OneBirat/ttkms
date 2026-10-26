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
  type ActiveBranch,
  isAbortError,
  setCsrfToken,
  type Access,
  type AuthResponse,
  type Module,
  type ModulesResponse,
  type Permission,
  type Today,
  type User,
} from "@/lib/api";
import { modulesFromNav } from "@/lib/modules";

export interface Session {
  user: User | null;
  /**
   * The user's own branch (admin.user_access.branch_id). Attendance and
   * payroll scope their screens to it; null for admins and unassigned users.
   */
  branchId: number | null;
  /** That branch's name ("Main branch"); null without a branch. */
  branchName: string | null;
  /** The ONE branch every screen works on - read it through useBranch() (lib/branch.tsx). */
  activeBranch: ActiveBranch | null;
  /** Take a fresh /api/auth/me body (after a branch switch) without reloading the shell. */
  applyAuth: (body: AuthResponse) => void;
  /** Effective permissions from /api/auth/me (role preset + per-user switches). */
  access: Access;
  /** `can("see_other_branches")`: false until the session has loaded. */
  can: (permission: Permission) => boolean;
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
    branchId: meBody.branch_id ?? null,
    branchName: meBody.branch_name ?? null,
    activeBranch: meBody.active_branch ?? null,
    access: meBody.access ?? {},
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
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [activeBranch, setActiveBranch] = useState<ActiveBranch | null>(null);
  const [access, setAccess] = useState<Access>({});
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
        setBranchId(result.branchId);
        setBranchName(result.branchName);
        setActiveBranch(result.activeBranch);
        setAccess(result.access);
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

  const applyAuth = useCallback((body: AuthResponse) => {
    setUser(body.user);
    setBranchId(body.branch_id ?? null);
    setBranchName(body.branch_name ?? null);
    setActiveBranch(body.active_branch ?? null);
    setAccess(body.access ?? {});
    if (body.csrf_token) setCsrfToken(body.csrf_token);
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
      setBranchId(null);
      setBranchName(null);
      setActiveBranch(null);
      setAccess({});
      setModules([]);
      setEnabled([]);
      router.push("/login");
    }
  }, [router]);

  const isEnabled = useCallback(
    (name: string) => enabled.includes(name),
    [enabled],
  );
  const can = useCallback(
    (permission: Permission) => Boolean(access[permission]),
    [access],
  );

  const value = useMemo<Session>(
    () => ({
      user,
      branchId,
      branchName,
      activeBranch,
      applyAuth,
      access,
      can,
      modules,
      enabled,
      isEnabled,
      today,
      loading,
      error,
      refresh,
      logout,
    }),
    [
      user,
      branchId,
      branchName,
      activeBranch,
      applyAuth,
      access,
      can,
      modules,
      enabled,
      isEnabled,
      today,
      loading,
      error,
      refresh,
      logout,
    ],
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
