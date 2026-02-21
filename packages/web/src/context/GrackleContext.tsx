import { createContext, useContext, type ReactNode } from "react";
import { useGrackleSocket } from "../hooks/useGrackleSocket.js";

type GrackleContextType = ReturnType<typeof useGrackleSocket>;

const GrackleContext = createContext<GrackleContextType | null>(null);

export function GrackleProvider({ children }: { children: ReactNode }) {
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
