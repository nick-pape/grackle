import { useEffect, type ReactNode } from "react";
import { useSidebarSetter } from "../context/SidebarContext.js";

/**
 * Declares sidebar content for the current component's lifetime.
 * Sets content on mount and clears it on unmount.
 *
 * @param content - The ReactNode to render in the sidebar slot. Callers should
 *   memoize this value (e.g. via `useMemo`) to avoid unnecessary effect re-runs.
 */
export function useSidebarSlot(content: ReactNode): void {
  const setContent = useSidebarSetter();

  useEffect(() => {
    setContent(content);
    return () => { setContent(undefined); };
  }, [content, setContent]);
}
