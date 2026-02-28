import React, { createContext, useContext, type ReactNode, type JSX } from "react";
import { useGrackleSocket } from "../hooks/useGrackleSocket.js";
import type { UseGrackleSocketResult } from "../hooks/useGrackleSocket.js";

/** Re-export the socket result type so mock providers can reference it. */
export type { UseGrackleSocketResult };

/** Alias for the context value type. */
export type GrackleContextType = UseGrackleSocketResult;

// eslint-disable-next-line @rushstack/no-new-null
const GrackleContext: React.Context<GrackleContextType | null> = createContext<GrackleContextType | null>(null);

/** Exported raw context for use by MockGrackleProvider and tests. */
export { GrackleContext };

/** Provides live WebSocket-backed Grackle state to the component tree. */
export function GrackleProvider({ children }: { children: ReactNode }): JSX.Element {
  const socket = useGrackleSocket();
  return (
    <GrackleContext.Provider value={socket}>{children}</GrackleContext.Provider>
  );
}

/** Consumes the Grackle context; must be called within a GrackleProvider or MockGrackleProvider. */
export function useGrackle(): GrackleContextType {
  const ctx = useContext(GrackleContext);
  if (!ctx) throw new Error("useGrackle must be used within GrackleProvider");
  return ctx;
}
