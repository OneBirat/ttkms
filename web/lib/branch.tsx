"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, errorMessage, type AuthResponse } from "@/lib/api";
import { BRANCH_CHANNEL, BranchContext, branchFromUrl, type ActiveBranchState } from "@/lib/branchContext";
import { useSession } from "@/lib/session";

export {
  BRANCH_CHANNEL,
  BranchContext,
  branchFromUrl,
  useActiveBranch,
  useBranch,
  withBranch,
  type ActiveBranchState,
  type BranchState,
} from "@/lib/branchContext";

/**
 * ONE active branch for the whole app (never "all branches"). The single source of truth is the
 * session's `active_branch` (/api/auth/me; kept on the user, so it survives reloads and logins);
 * the server scopes every branch-aware endpoint to it.
 *
 * setActiveBranch(id): PUT /api/me/active-branch, the session takes the answer, `version` goes up
 * (AppShell keys the page on it and screens put the branch id in their fetch keys, so everything is
 * fetched again), router.refresh(), and the other open tabs hear it on a BroadcastChannel (they
 * also re-check /me when they get focus). `?branch=<id>` in a URL is applied once (when the user may
 * see that branch) and removed from the URL.
 */
export function BranchProvider({ children }: { children: ReactNode }) {
  const { activeBranch, branchOptions, applyAuth, can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const canSwitch = can("see_other_branches");
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const current = useRef<number | null>(activeBranch?.id ?? null);

  // Any change of the active branch - here, another tab or a focus re-check - bumps version.
  useEffect(() => {
    const id = activeBranch?.id ?? null;
    if (current.current !== id) {
      current.current = id;
      setVersion((v) => v + 1);
    }
  }, [activeBranch?.id]);

  const recheck = useCallback(async () => {
    try {
      const me = await apiFetch<AuthResponse>("/api/auth/me");
      if ((me.active_branch?.id ?? null) !== current.current) {
        applyAuth(me);
        router.refresh();
      }
    } catch {
      /* a 401 redirects to /login inside apiFetch */
    }
  }, [applyAuth, router]);

  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(BRANCH_CHANNEL);
    ch.onmessage = (event: MessageEvent<{ branchId?: number }>) => {
      if (event.data?.branchId !== current.current) void recheck();
    };
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [recheck]);

  useEffect(() => {
    const onFocus = () => void recheck();
    const onVisible = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [recheck]);

  const setActiveBranch = useCallback(
    async (branchId: number) => {
      if (branchId === current.current) return;
      setSwitching(true);
      setError(null);
      try {
        const me = await apiFetch<AuthResponse>("/api/me/active-branch", {
          method: "PUT",
          json: { branch_id: branchId },
        });
        applyAuth(me);
        channel.current?.postMessage({ branchId: me.active_branch?.id ?? branchId });
        router.refresh();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSwitching(false);
      }
    },
    [applyAuth, router],
  );

  // ?branch=<id>: make it the active branch (when allowed), then drop it from the URL.
  useEffect(() => {
    const { branch, url } = branchFromUrl(window.location.href, {
      branchId: current.current,
      canSwitch,
      options: branchOptions,
    });
    if (url === null) return;
    router.replace(url, { scroll: false });
    if (branch !== null) void setActiveBranch(branch);
  }, [pathname, canSwitch, branchOptions, router, setActiveBranch]);

  const value = useMemo<ActiveBranchState>(
    () => ({
      branch: activeBranch,
      branches: canSwitch ? branchOptions : [],
      canSwitch,
      setActiveBranch,
      switching,
      error,
      version,
    }),
    [activeBranch, branchOptions, canSwitch, setActiveBranch, switching, error, version],
  );
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}
