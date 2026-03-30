import {
  createSigchldSubscriber, createEscalationAutoSubscriber,
  createOrphanReparentSubscriber, createLifecycleSubscriber,
  createRootTaskBootSubscriber, subscribe, emit,
  computeTaskStatus, findFirstConnectedEnvironment,
  startTaskSession, reanimateAgent,
} from "@grackle-ai/core";
import type { Disposable, PluginContext, SubscriberFactory } from "@grackle-ai/core";
import { taskStore, sessionStore, settingsStore } from "@grackle-ai/database";

/**
 * Wire all event subscribers (SIGCHLD, escalation, orphan reparent, lifecycle)
 * and optionally the root task auto-boot handler.
 *
 * Returns an array of Disposable handles so that all subscribers can be
 * cleanly unregistered during shutdown.
 *
 * @param options.skipRootAutostart - When true, skip wiring the root task boot
 *   (used in E2E tests where the root session would conflict with test sessions).
 * @returns Array of disposables — call `.dispose()` on each to unsubscribe.
 */
export function wireEventSubscribers(options: {
  skipRootAutostart: boolean;
}): Disposable[] {
  const pluginContext: PluginContext = { subscribe, emit };

  const factories: SubscriberFactory[] = [
    createSigchldSubscriber,
    createEscalationAutoSubscriber,
    createOrphanReparentSubscriber,
    createLifecycleSubscriber,
  ];

  if (!options.skipRootAutostart) {
    factories.push((ctx) => createRootTaskBootSubscriber(ctx, {
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

  return factories.map((factory) => factory(pluginContext));
}
