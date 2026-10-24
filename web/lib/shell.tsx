"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * What a page can ask of the app shell: open / close the phone menu drawer,
 * and take over the phone header (a screen that renders its own dark header
 * with a menu button, like the People phone screens, hides the shell's bar).
 */
export interface Shell {
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
  /** True while a page has claimed the phone header (see usePhoneHeader). */
  ownHeader: boolean;
  claimHeader: (claimed: boolean) => void;
}

const ShellContext = createContext<Shell | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [ownHeader, setOwnHeader] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const value = useMemo<Shell>(
    () => ({ menuOpen, openMenu, closeMenu, ownHeader, claimHeader: setOwnHeader }),
    [menuOpen, openMenu, closeMenu, ownHeader],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) {
    throw new Error("useShell must be used inside <AppShell>.");
  }
  return shell;
}

/**
 * Call from a phone screen that renders its own header: the shell hides its
 * phone bar and drops the main padding while the screen is mounted (a layout
 * effect, so the two headers are never painted together).
 */
export function usePhoneHeader(): void {
  const { claimHeader } = useShell();
  useLayoutEffect(() => {
    claimHeader(true);
    return () => claimHeader(false);
  }, [claimHeader]);
}
