import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'powerbia.sidebar';

interface SidebarValue {
  open: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarValue | null>(null);

/**
 * The toggle lives in the navbar and the panel it opens lives inside each route,
 * so the state has to sit above both. Open is the default; the choice is
 * remembered per browser, like the theme.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_KEY) !== 'closed');

  const toggle = useCallback(() => {
    setOpen((current) => {
      localStorage.setItem(STORAGE_KEY, current ? 'closed' : 'open');
      return !current;
    });
  }, []);

  const value = useMemo(() => ({ open, toggle }), [open, toggle]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarValue {
  const value = useContext(SidebarContext);
  if (!value) throw new Error('useSidebar must be used inside SidebarProvider');

  return value;
}
