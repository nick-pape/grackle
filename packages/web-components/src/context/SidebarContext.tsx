import React, { createContext, useCallback, useContext, useState, type JSX, type ReactNode } from "react";

/** Setter function for updating sidebar content. */
type SidebarSetter = (content: ReactNode | undefined) => void;

/**
 * Context that holds the current sidebar content node.
 * Consumed by the Sidebar component to render slot content.
 */
const SidebarContentContext: React.Context<ReactNode | undefined> = createContext<ReactNode | undefined>(undefined);

/**
 * Context that holds a stable setter for updating sidebar content.
 * Consumed by layout route wrappers to declare their sidebar content.
 */
const SidebarSetterContext: React.Context<SidebarSetter | undefined> = createContext<SidebarSetter | undefined>(undefined);

/** Props for the SidebarProvider component. */
interface SidebarProviderProps {
  /** Child components. */
  children: ReactNode;
}

/** Provides sidebar slot state to the component tree. */
export function SidebarProvider({ children }: SidebarProviderProps): JSX.Element {
  const [content, setContent] = useState<ReactNode | undefined>(undefined);

  const stableSetContent: SidebarSetter = useCallback((node: ReactNode | undefined) => {
    setContent(node);
  }, []);

  return (
    <SidebarSetterContext.Provider value={stableSetContent}>
      <SidebarContentContext.Provider value={content}>
        {children}
      </SidebarContentContext.Provider>
    </SidebarSetterContext.Provider>
  );
}

/** Read the current sidebar content. Returns `undefined` when no content is set. */
export function useSidebarContent(): ReactNode | undefined {
  return useContext(SidebarContentContext);
}

/** Get the sidebar content setter. Must be called within a SidebarProvider. */
export function useSidebarSetter(): SidebarSetter {
  const setter = useContext(SidebarSetterContext);
  if (setter === undefined) {
    throw new Error("useSidebarSetter must be used within a SidebarProvider");
  }
  return setter;
}
