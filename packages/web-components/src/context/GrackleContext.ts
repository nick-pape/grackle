/**
 * Shared GrackleContext definition used by both the real GrackleProvider (in @grackle-ai/web)
 * and MockGrackleProvider (in this package). Only the raw context + consumer hook live here;
 * the actual provider with gRPC wiring lives in @grackle-ai/web.
 *
 * @module
 */

import React, { createContext, useContext } from "react";
import type { UseGrackleSocketResult } from "./GrackleContextTypes.js";

/** Re-export the socket result type so consumers can reference it. */
export type { UseGrackleSocketResult };

/** Alias for the context value type. */
export type GrackleContextType = UseGrackleSocketResult;

/** The raw React context for Grackle state. */
export const GrackleContext: React.Context<GrackleContextType | undefined> = createContext<GrackleContextType | undefined>(undefined);

/** Consumes the Grackle context; must be called within a GrackleProvider or MockGrackleProvider. */
export function useGrackle(): GrackleContextType {
  const ctx = useContext(GrackleContext);
  if (!ctx) {
    throw new Error("useGrackle must be used within GrackleProvider");
  }
  return ctx;
}
