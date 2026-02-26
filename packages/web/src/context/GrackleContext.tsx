import React, { createContext, useContext, type ReactNode, type JSX } from "react";
import { useGrackleSocket } from "../hooks/useGrackleSocket.js";

type GrackleContextType = ReturnType<typeof useGrackleSocket>;

// eslint-disable-next-line @rushstack/no-new-null
const GrackleContext: React.Context<GrackleContextType | null> = createContext<GrackleContextType | null>(null);

export function GrackleProvider({ children }: { children: ReactNode }): JSX.Element {
  const socket = useGrackleSocket();
  return (
    <GrackleContext.Provider value={socket}>{children}</GrackleContext.Provider>
  );
}

export function useGrackle(): GrackleContextType {
  const ctx = useContext(GrackleContext);
  if (!ctx) throw new Error("useGrackle must be used within GrackleProvider");
  return ctx;
}
