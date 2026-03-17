/**
 * Logger interface compatible with pino's structured-logging signature.
 * All SDK functions accept an optional {@link AdapterLogger} parameter;
 * when omitted, the {@link defaultLogger} (console) is used.
 */
export interface AdapterLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

/** Console-based logger used when no logger is explicitly provided. */
export const defaultLogger: AdapterLogger = {
  info(_obj: object, msg: string): void {
    console.log("[adapter-sdk]", msg);
  },
  warn(_obj: object, msg: string): void {
    console.warn("[adapter-sdk]", msg);
  },
  error(_obj: object, msg: string): void {
    console.error("[adapter-sdk]", msg);
  },
  debug(_obj: object, msg: string): void {
    console.debug("[adapter-sdk]", msg);
  },
};
