import type { ReactNode, JSX } from "react";
import { useGrackleSocket } from "../hooks/useGrackleSocket.js";
import { GrackleContext, useGrackle } from "@grackle-ai/web-components";
import type { UseGrackleSocketResult } from "@grackle-ai/web-components";

/** Re-export so existing consumers keep working. */
export type { UseGrackleSocketResult };
export { GrackleContext, useGrackle };

/** Provides live ConnectRPC-backed Grackle state to the component tree. */
export function GrackleProvider({ children }: { children: ReactNode }): JSX.Element {
  const socket = useGrackleSocket();
  return (
    <GrackleContext.Provider value={socket}>{children}</GrackleContext.Provider>
  );
}
