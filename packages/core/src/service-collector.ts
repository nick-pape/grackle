import type { ConnectRouter } from "@connectrpc/connect";
import type { DescService } from "@bufbuild/protobuf";

/**
 * A record of handler method implementations for a gRPC service.
 *
 * Uses `any` because handler functions have concrete parameter types (e.g.,
 * `(req: GetSettingRequest) => Promise<SettingResponse>`) that are not
 * assignable to `(...args: unknown[]) => unknown` due to contravariance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerGroup = Record<string, (...args: any[]) => any>;

/**
 * Collects gRPC handler groups and produces ConnectRPC route registration.
 *
 * Plugins add their handlers via {@link addHandlers}, then the server calls
 * {@link buildRoutes} to get the final `(router: ConnectRouter) => void`
 * function for `connectNodeAdapter`.
 */
export interface ServiceCollector {
  /** Add handler methods to a service. Multiple calls merge handlers (last-write-wins). */
  addHandlers(service: DescService, handlers: HandlerGroup): void;

  /** Build the route registration function for `connectNodeAdapter({ routes })`. */
  buildRoutes(): (router: ConnectRouter) => void;

  /** Get all collected handlers for a service. Returns `{}` if no handlers registered. */
  getHandlers(service: DescService): HandlerGroup;
}

/** Create a new empty {@link ServiceCollector}. */
export function createServiceCollector(): ServiceCollector {
  const registry = new Map<DescService, HandlerGroup>();

  return {
    addHandlers(service: DescService, handlers: HandlerGroup): void {
      const existing = registry.get(service) ?? {};
      registry.set(service, { ...existing, ...handlers });
    },

    buildRoutes(): (router: ConnectRouter) => void {
      return (router: ConnectRouter) => {
        for (const [service, handlers] of registry) {
          router.service(service, handlers as unknown as Parameters<ConnectRouter["service"]>[1]);
        }
      };
    },

    getHandlers(service: DescService): HandlerGroup {
      const handlers = registry.get(service);
      return handlers ? { ...handlers } : {};
    },
  };
}
