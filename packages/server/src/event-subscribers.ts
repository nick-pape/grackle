import {
  initSigchldSubscriber, initEscalationAutoSubscriber,
  initOrphanReparentSubscriber, initLifecycleManager,
  createRootTaskBoot, subscribe,
  computeTaskStatus, findFirstConnectedEnvironment,
  startTaskSession, reanimateAgent,
} from "@grackle-ai/core";
import { taskStore, sessionStore, settingsStore } from "@grackle-ai/database";

/**
 * Wire all event subscribers (SIGCHLD, escalation, orphan reparent, lifecycle)
 * and optionally the root task auto-boot handler.
 *
 * The root task boot is wired to `environment.changed` and `setting.changed`
 * (onboarding completion) events, using a reanimate-first strategy with
 * exponential backoff.
 *
 * @param options.skipRootAutostart - When true, skip wiring the root task boot
 *   (used in E2E tests where the root session would conflict with test sessions).
 */
export function wireEventSubscribers(options: {
  skipRootAutostart: boolean;
}): void {
  // Wire SIGCHLD: notify parent tasks when child sessions reach terminal status
  initSigchldSubscriber();

  // Wire escalation auto-detection: notify human when standalone tasks go idle
  initEscalationAutoSubscriber();

  // Wire orphan reparenting: reparent non-terminal children when parent task completes/fails
  initOrphanReparentSubscriber();

  // Wire lifecycle manager: auto-hibernate sessions when all fds are closed
  initLifecycleManager();

  if (!options.skipRootAutostart) {
    const tryBootRootTask = createRootTaskBoot({
      getTask: taskStore.getTask,
      listSessionsForTask: sessionStore.listSessionsForTask,
      getLatestSessionForTask: sessionStore.getLatestSessionForTask,
      computeTaskStatus,
      findFirstConnectedEnvironment,
      startTaskSession,
      reanimateAgent,
      isOnboarded: () => settingsStore.getSetting("onboarding_completed") === "true",
    });

    subscribe((event) => {
      if (event.type === "environment.changed") {
        tryBootRootTask().catch(() => { /* logged inside */ });
      }
      // Also try when onboarding completes — the environment is already
      // connected but boot was deferred until the user chose a runtime.
      if (event.type === "setting.changed") {
        const payload = event.payload as { key?: string; value?: string };
        if (payload.key === "onboarding_completed" && payload.value === "true") {
          tryBootRootTask().catch(() => { /* logged inside */ });
        }
      }
    });
  }
}
