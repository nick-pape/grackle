/** Logger interface for auth modules. */
export interface AuthLogger {
  info(obj: object, msg: string, ...args: unknown[]): void;
  warn(objOrMsg: object | string, msg?: string, ...args: unknown[]): void;
}

/** Default console-based logger. */
export const defaultAuthLogger: AuthLogger = {
  info(_obj: object, msg: string, ...args: unknown[]): void {
    console.log("[auth]", msg, ...args);
  },
  warn(objOrMsg: object | string, msg?: string, ...args: unknown[]): void {
    if (typeof objOrMsg === "string") {
      console.warn("[auth]", objOrMsg, msg, ...args);
    } else {
      console.warn("[auth]", msg, ...args);
    }
  },
};

let logger: AuthLogger = defaultAuthLogger;

/** Set the logger used by all auth modules. Call once at startup. */
export function setAuthLogger(l: AuthLogger): void {
  logger = l;
}

/** Get the current auth logger. */
export function getAuthLogger(): AuthLogger {
  return logger;
}
