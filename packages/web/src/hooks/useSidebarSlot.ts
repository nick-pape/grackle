import { useLayoutEffect, type ReactNode } from "react";
import { useSidebarSetter } from "@grackle-ai/web-components";

/**
 * Declares sidebar content for the current component's lifetime.
 * Sets content before paint and clears it on unmount.
 *
 * Uses `useLayoutEffect` so the sidebar/hamburger state is synchronised with
 * route changes before the browser paints, avoiding flicker.
 *
 * @param content - The ReactNode to render in the sidebar slot. Callers should
 *   memoize this value (e.g. via `useMemo`) to avoid unnecessary effect re-runs.
 */
export function useSidebarSlot(content: ReactNode): void {
  const setContent = useSidebarSetter();

  useLayoutEffect(() => {
    setContent(content);
    return () => { setContent(undefined); };
  }, [content, setContent]);
}
