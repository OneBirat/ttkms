"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch, errorMessage, type ActiveBranch, type AuthResponse } from "@/lib/api";
import { BRANCH_CHANNEL, BranchContext, activeBranchesAZ, type BranchRow, type BranchState } from "@/lib/branchContext";
import { useSession } from "@/lib/session";

export { BRANCH_CHANNEL, BranchContext, activeBranchesAZ, useBranch, withBranch, type BranchState } from "@/lib/branchContext";

/**
 * ONE active branch for the whole app (no page on another branch, no "all branches"). The single
 * source of truth is /api/auth/me `active_branch` (kept on the user, so it survives logins); the
 * server scopes every branch-aware endpoint to it, so pages do not send a branch at all.
 *
 * Users with `see_other_branches` switch it (PATCH /api/auth/me/active-branch): the session takes
 * the answer, `version` goes up - AppShell keys the page on it, so the current page refetches -
 * and the other open tabs hear it on a BroadcastChannel (and re-check /me when they get focus).
 * Everyone else sees their own branch's name and nothing to switch.
 */
export function BranchProvider({ children }: { children: ReactNode }) {
  const { activeBranch, applyAuth, can } = useSession();
  const canSwitch = can("see_other_branches");
  const [branches, setBranches] = useState<ActiveBranch[]>([]);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const current = useRef<number | null>(activeBranch?.id ?? null);

  // Any change of the active branch - from here, another tab or a focus re-check - bumps version.
  useEffect(() => {
    const id = activeBranch?.id ?? null;
    if (current.current !== id) {
      current.current = id;
      setVersion((v) => v + 1);
    }
  }, [activeBranch?.id]);

  useEffect(() => {
    if (!canSwitch) {
      setBranches([]);
      return;
    }
    const controller = new AbortController();
    apiFetch<BranchRow[]>("/api/core/branches?active=true", { signal: controller.signal })
      .then((rows) => setBranches(activeBranchesAZ(rows)))
      .catch(() => {
        /* the switcher then lists only the active branch */
      });
    return () => controller.abort();
  }, [canSwitch]);

  // Other tabs: a switch there is heard here; focus re-checks /me in case a message was missed.
  const recheck = useCallback(async () => {
    try {
      const me = await apiFetch<AuthResponse>("/api/auth/me");
      if ((me.active_branch?.id ?? null) !== current.current) applyAuth(me);
    } catch {
      /* a 401 redirects to /login inside apiFetch */
    }
  }, [applyAuth]);

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

  const switchTo = useCallback(
    async (branchId: number) => {
      if (!canSwitch || branchId === current.current) return;
      setSwitching(true);
      setError(null);
      try {
        const me = await apiFetch<AuthResponse>("/api/auth/me/active-branch", {
          method: "PATCH",
          json: { branch_id: branchId },
        });
        applyAuth(me);
        channel.current?.postMessage({ branchId: me.active_branch?.id ?? branchId });
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSwitching(false);
      }
    },
    [canSwitch, applyAuth],
  );

  const value = useMemo<BranchState>(
    () => ({
      branch: activeBranch,
      branches: branches.length ? branches : activeBranch ? [activeBranch] : [],
      canSwitch,
      switching,
      error,
      version,
      switchTo,
    }),
    [activeBranch, branches, canSwitch, switching, error, version, switchTo],
  );
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}
