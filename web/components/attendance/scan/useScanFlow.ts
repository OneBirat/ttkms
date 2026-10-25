"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createScanFlow, type ScanFlow, type ScanFlowDeps, type ScanFlowState } from "./scanFlow";

const EMPTY: ScanFlowState = { scan: null, count: 0 };

/**
 * React binding for the scan loop: one controller per mounted screen, latest
 * deps through a ref, state via useSyncExternalStore, timers cleared on
 * unmount. With `trapBack` the phone's hardware / browser Back maps to the
 * same thing as Escape (and closes the scanner from the camera) through a
 * history entry pushed while the scanner is open.
 */
export function useScanFlow(deps: ScanFlowDeps, options: { trapBack?: boolean } = {}): { state: ScanFlowState; flow: ScanFlow } {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const flowRef = useRef<ScanFlow | null>(null);
  if (!flowRef.current) {
    const live: ScanFlowDeps = {
      api: {
        lookup: (code) => depsRef.current.api.lookup(code),
        mark: (req) => depsRef.current.api.mark(req),
        balance: (id, kind) => depsRef.current.api.balance(id, kind),
        history: (id, monthKey) => depsRef.current.api.history(id, monthKey),
        pay: (input) => depsRef.current.api.pay(input),
        employeeMonth: (id, monthKey) => depsRef.current.api.employeeMonth(id, monthKey),
      },
      currentDraft: (emp, today) => depsRef.current.currentDraft(emp, today),
      onMarked: (result) => depsRef.current.onMarked?.(result),
      monthKey: () => depsRef.current.monthKey(),
      canPay: () => depsRef.current.canPay?.() ?? true,
      sounds: {
        read: () => depsRef.current.sounds?.read?.(),
        name: (e) => depsRef.current.sounds?.name?.(e),
        already: (e) => depsRef.current.sounds?.already?.(e),
        marked: (s, h) => depsRef.current.sounds?.marked?.(s, h),
        paid: (e, t, a) => depsRef.current.sounds?.paid?.(e, t, a),
        unknown: () => depsRef.current.sounds?.unknown?.(),
        skip: () => depsRef.current.sounds?.skip?.(),
      },
    };
    flowRef.current = createScanFlow(live);
  }
  const flow = flowRef.current;

  useEffect(() => {
    flow.resume();
    return () => flow.dispose();
  }, [flow]);

  const state = useSyncExternalStore(flow.subscribe, flow.getState, () => EMPTY);

  // ---- hardware / browser Back on the phone
  const trapBack = options.trapBack ?? false;
  const open = state.scan !== null;
  const pushedRef = useRef(false);
  const ignorePopRef = useRef(false);

  useEffect(() => {
    if (!trapBack || typeof window === "undefined") return;
    if (open && !pushedRef.current) {
      try {
        window.history.pushState({ ttkScan: true }, "");
        pushedRef.current = true;
      } catch {
        // Without history we simply have no Back mapping.
      }
    } else if (!open && pushedRef.current) {
      pushedRef.current = false;
      ignorePopRef.current = true;
      try {
        window.history.back();
      } catch {
        ignorePopRef.current = false;
      }
    }
  }, [open, trapBack]);

  useEffect(() => {
    if (!trapBack || typeof window === "undefined") return;
    const onPop = () => {
      if (ignorePopRef.current) {
        ignorePopRef.current = false;
        return;
      }
      if (!pushedRef.current) return;
      pushedRef.current = false;
      const stillOpen = flow.back();
      if (stillOpen) {
        try {
          window.history.pushState({ ttkScan: true }, "");
          pushedRef.current = true;
        } catch {
          // Fine.
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [trapBack, flow]);

  return { state, flow };
}
