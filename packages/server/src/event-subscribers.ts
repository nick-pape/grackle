import {
  computeTaskStatus,
  findFirstConnectedEnvironment,
  startTaskSession,
  reanimateAgent,
} from "@grackle-ai/core";
import type { Disposable, PluginContext, SubscriberFactory } from "@grackle-ai/plugin-sdk";
import {
  createLifecycleSubscriber,
  createRootTaskBootSubscriber,
  createAgentRootTaskSubscriber,
} from "@grackle-ai/plugin-core";
import { agentStore, taskStore, sessionStore, settingsStore } from "@grackle-ai/database";
import { randomUUID } from "node:crypto";

/**
 * Create the core event subscribers.
 *
 * Orchestration subscribers (sigchld, escalation-auto, orphan-reparent) are
 * intentionally excluded — they are contributed by `@grackle-ai/plugin-orchestration`.
 *
 * @param ctx - Plugin context. Reads `ctx.config.skipRootAutostart` to decide
 *   whether to include the root task boot subscriber.
 * @returns Array of disposables.
 */
export function createEventSubscribers(ctx: PluginContext): Disposable[] {
  const factories: SubscriberFactory[] = [createLifecycleSubscriber];

  if (!ctx.config.skipRootAutostart) {
    factories.push((pluginCtx) =>
      createRootTaskBootSubscriber(pluginCtx, {
        getTask: taskStore.getTask,
        listSessionsForTask: sessionStore.listSessionsForTask,
        getLatestSessionForTask: sessionStore.getLatestSessionForTask,
        computeTaskStatus,
        findFirstConnectedEnvironment,
        startTaskSession,
        reanimateAgent,
        isOnboarded: () => settingsStore.getSetting("onboarding_completed") === "true",
      }),
    );
  }

  // Auto-create the root task for each new Agent (#1418). Independent of the
  // root-task autostart flag above (which gates the *system* root task).
  factories.push((pluginCtx) =>
    createAgentRootTaskSubscriber(pluginCtx, {
      getAgent: agentStore.getAgent,
      getRootTaskForAgent: taskStore.getRootTaskForAgent,
      insertTask: taskStore.insertTask,
      newId: () => randomUUID(),
    }),
  );

  return factories.map((factory) => factory(ctx));
}
