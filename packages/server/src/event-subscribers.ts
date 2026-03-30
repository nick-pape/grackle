import {
  subscribe, emit,
  computeTaskStatus, findFirstConnectedEnvironment,
  startTaskSession, reanimateAgent,
} from "@grackle-ai/core";
import type { Disposable, PluginContext, SubscriberFactory } from "@grackle-ai/core";
import {
  createSigchldSubscriber, createEscalationAutoSubscriber,
  createOrphanReparentSubscriber, createLifecycleSubscriber,
  createRootTaskBootSubscriber,
} from "@grackle-ai/plugin-core";
import { taskStore, sessionStore, settingsStore } from "@grackle-ai/database";

/**
 * Context accepted by createEventSubscribers.
 *
 * Core's subscriber factories accept the narrow `PluginContext` (subscribe + emit).
 * The SDK's wider `PluginContext` (with logger + config) is structurally compatible.
 */
interface SubscriberContext extends PluginContext {
  config?: { skipRootAutostart?: boolean };
}

/**
 * Create all event subscribers for the core plugin.
 *
 * @param ctx - Plugin context. Reads `ctx.config.skipRootAutostart` to decide
 *   whether to include the root task boot subscriber.
 * @returns Array of disposables.
 */
export function createEventSubscribers(ctx: SubscriberContext): Disposable[] {
  const factories: SubscriberFactory[] = [
    createSigchldSubscriber,
    createEscalationAutoSubscriber,
    createOrphanReparentSubscriber,
    createLifecycleSubscriber,
  ];

  if (!ctx.config?.skipRootAutostart) {
    factories.push((pluginCtx) => createRootTaskBootSubscriber(pluginCtx, {
      getTask: taskStore.getTask,
      listSessionsForTask: sessionStore.listSessionsForTask,
      getLatestSessionForTask: sessionStore.getLatestSessionForTask,
      computeTaskStatus,
      findFirstConnectedEnvironment,
      startTaskSession,
      reanimateAgent,
      isOnboarded: () => settingsStore.getSetting("onboarding_completed") === "true",
    }));
  }

  return factories.map((factory) => factory(ctx));
}

/**
 * Wire all event subscribers (backward-compatible wrapper).
 *
 * @deprecated Use `createEventSubscribers(ctx)` with a PluginContext instead.
 */
export function wireEventSubscribers(options: {
  skipRootAutostart: boolean;
}): Disposable[] {
  return createEventSubscribers({
    subscribe,
    emit,
    config: { skipRootAutostart: options.skipRootAutostart },
  });
}
