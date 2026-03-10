/**
 * Mock provider for visual testing without a running Grackle server.
 *
 * Wraps children with the same GrackleContext used by the real provider,
 * but supplies fully interactive mock state. Actions like spawn, kill,
 * sendInput, and task lifecycle methods all produce realistic state
 * transitions and timed event streams.
 *
 * Activate by adding `?mock` to the URL (e.g. `http://localhost:3000?mock`).
 */

import {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
  type JSX,
} from "react";
import { GrackleContext } from "../context/GrackleContext.js";
import type { UseGrackleSocketResult } from "../context/GrackleContext.js";
import type {
  Session,
  SessionEvent,
  FindingData,
  TaskData,
  TaskDiffData,
  Project,
  TokenInfo,
} from "../hooks/useGrackleSocket.js";
import {
  MOCK_ENVIRONMENTS,
  MOCK_SESSIONS,
  MOCK_EVENTS,
  MOCK_PROJECTS,
  MOCK_TASKS,
  MOCK_FINDINGS,
  MOCK_TOKENS,
  MOCK_TASK_DIFF,
  MOCK_STREAM_SCENARIOS,
  type MockStreamStep,
} from "./mockData.js";

// ─── Constants ──────────────────────────────────────

/** Delay before the "waiting_input" status is set after the last pre-pause step. */
const WAITING_INPUT_DELAY_MS: number = 400;

/** Simulated network delay for loadTaskDiff. */
const LOAD_DIFF_DELAY_MS: number = 600;

// ─── Props ──────────────────────────────────────────

/** Props for the MockGrackleProvider component. */
interface MockGrackleProviderProps {
  children: ReactNode;
}

// ─── Provider ───────────────────────────────────────

/**
 * Provides interactive mock data matching the shape of UseGrackleSocketResult.
 * All actions produce real state changes so every UI path is exercisable.
 */
export function MockGrackleProvider({ children }: MockGrackleProviderProps): JSX.Element {
  // ── State ─────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>(MOCK_SESSIONS);
  const [events, setEvents] = useState<SessionEvent[]>(MOCK_EVENTS);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [tasks, setTasks] = useState<TaskData[]>(MOCK_TASKS);
  const [findings, setFindings] = useState<FindingData[]>(MOCK_FINDINGS);
  const [tokens, setTokens] = useState<TokenInfo[]>(MOCK_TOKENS);
  const [taskDiff, setTaskDiff] = useState<TaskDiffData | undefined>(MOCK_TASK_DIFF);

  // ── Refs ──────────────────────────────────────────
  /** Auto-incrementing counter for generating unique mock IDs. */
  const counterRef = useRef<number>(0);
  /** Index into MOCK_STREAM_SCENARIOS, cycling through scenarios. */
  const scenarioIndexRef = useRef<number>(0);
  /** All active timeouts for cleanup on unmount. */
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  /** Per-session timeout tracking for selective cancellation (kill). */
  const sessionTimersRef = useRef<Map<string, Set<ReturnType<typeof setTimeout>>>>(new Map());
  /** Ref mirror of tasks state for reading current values without triggering re-renders. */
  const tasksRef = useRef<TaskData[]>(tasks);
  tasksRef.current = tasks;
  /** Resume steps keyed by sessionId, stored when a scenario pauses for input. */
  const pendingResumeRef = useRef<Map<string, MockStreamStep[]>>(new Map());
  /**
   * Tracks task review transitions after a paused scenario resumes.
   * Maps sessionId to { taskId, delayAfterResume }.
   */
  const pendingTaskReviewRef = useRef<
    Map<string, { taskId: string; delayAfterResume: number }>
  >(new Map());

  // ── Helpers ───────────────────────────────────────

  /** Generates a unique mock ID with the given prefix (e.g. "mock-sess-001"). */
  const nextId = useCallback((prefix: string): string => {
    counterRef.current += 1;
    return `mock-${prefix}-${String(counterRef.current).padStart(3, "0")}`;
  }, []);

  /** Returns the next scenario from the rotating list. */
  const nextScenario = useCallback(() => {
    const scenario = MOCK_STREAM_SCENARIOS[scenarioIndexRef.current % MOCK_STREAM_SCENARIOS.length];
    scenarioIndexRef.current += 1;
    return scenario;
  }, []);

  /** Schedules a callback, tracking it globally and optionally per-session. */
  const schedule = useCallback(
    (fn: () => void, delayMs: number, sessionId?: string): void => {
      const handle = setTimeout(() => {
        timersRef.current.delete(handle);
        if (sessionId) {
          sessionTimersRef.current.get(sessionId)?.delete(handle);
        }
        fn();
      }, delayMs);
      timersRef.current.add(handle);
      if (sessionId) {
        if (!sessionTimersRef.current.has(sessionId)) {
          sessionTimersRef.current.set(sessionId, new Set());
        }
        sessionTimersRef.current.get(sessionId)!.add(handle);
      }
    },
    [],
  );

  /** Cancels all pending timers for a given session. */
  const cancelSessionTimers = useCallback((sessionId: string): void => {
    const sessionHandles = sessionTimersRef.current.get(sessionId);
    if (sessionHandles) {
      sessionHandles.forEach((handle) => {
        clearTimeout(handle);
        timersRef.current.delete(handle);
      });
      sessionTimersRef.current.delete(sessionId);
    }
  }, []);

  /** Updates a single session's status in state. */
  const updateSessionStatus = useCallback((sessionId: string, status: string): void => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, status } : s)),
    );
  }, []);

  /** Appends a single event to the events array. */
  const appendEvent = useCallback((event: SessionEvent): void => {
    setEvents((prev) => [...prev, event]);
  }, []);

  /**
   * Plays a sequence of stream steps, appending events and updating session
   * status as each step fires. Calls onComplete after the last step.
   */
  const playScenario = useCallback(
    (
      sessionId: string,
      steps: MockStreamStep[],
      onComplete?: () => void,
    ): void => {
      steps.forEach((step, index) => {
        schedule(
          () => {
            const event: SessionEvent = {
              sessionId,
              ...step.event,
              timestamp: new Date().toISOString(),
            };
            appendEvent(event);

            // Status events also update the session record
            if (step.event.eventType === "status") {
              updateSessionStatus(sessionId, step.event.content);
            }

            // Fire onComplete after the last step
            if (index === steps.length - 1 && onComplete) {
              onComplete();
            }
          },
          step.delayMs,
          sessionId,
        );
      });
    },
    [schedule, appendEvent, updateSessionStatus],
  );

  // ── Actions ───────────────────────────────────────

  /** Spawns a new session, appends it to state, and plays a stream scenario. */
  const spawn: UseGrackleSocketResult["spawn"] = useCallback(
    (environmentId: string, prompt: string, _model?: string, runtime?: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] spawn", { environmentId, prompt, runtime });

      const sessionId = nextId("sess");
      const newSession: Session = {
        id: sessionId,
        environmentId,
        runtime: runtime || "claude-code",
        status: "running",
        prompt,
        startedAt: new Date().toISOString(),
      };

      setSessions((prev) => [...prev, newSession]);
      setLastSpawnedId(sessionId);

      const scenario = nextScenario();
      // eslint-disable-next-line no-console
      console.log(`[MockGrackle] Playing scenario: ${scenario.label}`);

      if (scenario.pauseForInput) {
        // Play steps up to and including pauseAfterStep, then pause
        const pauseIndex = scenario.pauseAfterStep ?? scenario.steps.length - 1;
        const preSteps = scenario.steps.slice(0, pauseIndex + 1);
        const lastStepDelay = preSteps.length > 0 ? preSteps[preSteps.length - 1].delayMs : 0;

        playScenario(sessionId, preSteps);

        // After the last pre-pause step, transition to waiting_input
        schedule(
          () => {
            updateSessionStatus(sessionId, "waiting_input");
            appendEvent({
              sessionId,
              eventType: "status",
              timestamp: new Date().toISOString(),
              content: "waiting_input",
            });
          },
          lastStepDelay + WAITING_INPUT_DELAY_MS,
          sessionId,
        );

        // Store resume steps for sendInput
        if (scenario.resumeSteps) {
          pendingResumeRef.current.set(sessionId, scenario.resumeSteps);
        }
      } else {
        // Play all steps straight through
        playScenario(sessionId, scenario.steps);
      }
    },
    [nextId, nextScenario, playScenario, schedule, updateSessionStatus, appendEvent],
  );

  /** Kills a session: cancels timers, sets status to killed, fails associated tasks. */
  const kill: UseGrackleSocketResult["kill"] = useCallback(
    (sessionId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] kill", sessionId);

      // 1. Cancel pending timers for this session
      cancelSessionTimers(sessionId);

      // 2. Remove any pending resume steps
      pendingResumeRef.current.delete(sessionId);

      // 3. Update session status to "killed"
      updateSessionStatus(sessionId, "killed");

      // 4. Append a status event
      appendEvent({
        sessionId,
        eventType: "status",
        timestamp: new Date().toISOString(),
        content: "killed",
      });

      // 5. Fail any in-progress task whose sessionId matches
      setTasks((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId && t.status === "in_progress"
            ? { ...t, status: "failed" }
            : t,
        ),
      );
    },
    [cancelSessionTimers, updateSessionStatus, appendEvent],
  );

  /** No-op refresh — the mock has no server to re-fetch from. */
  const refresh: UseGrackleSocketResult["refresh"] = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log("[MockGrackle] refresh");
  }, []);

  /** No-op — events are already accumulated in state. */
  const loadSessionEvents: UseGrackleSocketResult["loadSessionEvents"] = useCallback(
    (sessionId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] loadSessionEvents", sessionId);
    },
    [],
  );

  /** Clears all events from state. */
  const clearEvents: UseGrackleSocketResult["clearEvents"] = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log("[MockGrackle] clearEvents");
    setEvents([]);
  }, []);

  /** Creates a new project and adds it to state. */
  const createProject: UseGrackleSocketResult["createProject"] = useCallback(
    (name: string, description?: string, repoUrl?: string, defaultEnvironmentId?: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] createProject", { name, description });

      const newProject: Project = {
        id: nextId("proj"),
        name,
        description: description || "",
        repoUrl: repoUrl || "",
        defaultEnvironmentId: defaultEnvironmentId || "",
        status: "active",
        createdAt: new Date().toISOString(),
      };

      setProjects((prev) => [...prev, newProject]);
    },
    [nextId],
  );

  /** Sets a project's status to "archived". */
  const archiveProject: UseGrackleSocketResult["archiveProject"] = useCallback(
    (projectId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] archiveProject", projectId);
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, status: "archived" } : p)),
      );
    },
    [],
  );

  /** No-op — tasks are already in state from initial load. */
  const loadTasks: UseGrackleSocketResult["loadTasks"] = useCallback(
    (projectId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] loadTasks", projectId);
    },
    [],
  );

  /** Creates a new task and adds it to state. */
  const createTask: UseGrackleSocketResult["createTask"] = useCallback(
    (
      projectId: string,
      title: string,
      description?: string,
      environmentId?: string,
      dependsOn?: string[],
      parentTaskId?: string,
    ) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] createTask", { projectId, title, parentTaskId });

      setTasks((prev) => {
        const projectTasks = prev.filter((t) => t.projectId === projectId);
        const maxSort = projectTasks.reduce((max, t) => Math.max(max, t.sortOrder), 0);
        const parent = parentTaskId ? prev.find((t) => t.id === parentTaskId) : undefined;
        if (parentTaskId && !parent) {
          // eslint-disable-next-line no-console
          console.warn("[MockGrackle] Parent task not found:", parentTaskId);
          return prev;
        }
        if (parent && !parent.canDecompose) {
          // eslint-disable-next-line no-console
          console.warn("[MockGrackle] Parent task does not have decomposition rights:", parentTaskId);
          return prev;
        }
        const depth = parent ? parent.depth + 1 : 0;

        const newTask: TaskData = {
          id: nextId("task"),
          projectId,
          title,
          description: description || "",
          status: "pending",
          branch: "",
          environmentId: environmentId || "",
          sessionId: "",
          dependsOn: dependsOn || [],
          reviewNotes: "",
          sortOrder: maxSort + 1,
          createdAt: new Date().toISOString(),
          parentTaskId: parentTaskId || "",
          depth,
          childTaskIds: [],
          canDecompose: !parentTaskId,
        };

        return [...prev, newTask];
      });
    },
    [nextId],
  );

  /**
   * Starts a task: creates a new session, links it to the task, sets the
   * task to "in_progress", and plays a stream scenario. On scenario
   * completion, transitions the task to "review".
   *
   * Also handles retry from "failed" — the task gets a fresh session.
   */
  const startTask: UseGrackleSocketResult["startTask"] = useCallback(
    (taskId: string, runtime?: string, _model?: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] startTask", { taskId, runtime });

      // Find the task to get its metadata
      const target = tasksRef.current.find((t) => t.id === taskId);
      const taskEnvironmentId = target?.environmentId ?? "";
      const taskTitle = target?.title ?? "";

      const sessionId = nextId("sess");
      const newSession: Session = {
        id: sessionId,
        environmentId: taskEnvironmentId || "env-local-01",
        runtime: runtime || "claude-code",
        status: "running",
        prompt: taskTitle || taskId,
        startedAt: new Date().toISOString(),
      };

      setSessions((prev) => [...prev, newSession]);

      // Update task: status → "in_progress", sessionId → new session, branch → mock branch
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: "in_progress",
                sessionId,
                branch: `mock/${taskId.slice(0, 8)}`,
              }
            : t,
        ),
      );

      // Pick and play a scenario
      const scenario = nextScenario();
      // eslint-disable-next-line no-console
      console.log(`[MockGrackle] Playing task scenario: ${scenario.label}`);

      if (scenario.pauseForInput) {
        const pauseIndex = scenario.pauseAfterStep ?? scenario.steps.length - 1;
        const preSteps = scenario.steps.slice(0, pauseIndex + 1);
        const lastStepDelay = preSteps.length > 0 ? preSteps[preSteps.length - 1].delayMs : 0;

        playScenario(sessionId, preSteps);

        schedule(
          () => {
            updateSessionStatus(sessionId, "waiting_input");
            appendEvent({
              sessionId,
              eventType: "status",
              timestamp: new Date().toISOString(),
              content: "waiting_input",
            });
          },
          lastStepDelay + WAITING_INPUT_DELAY_MS,
          sessionId,
        );

        // Store resume steps; on resume completion, transition task to "review"
        if (scenario.resumeSteps) {
          // Append a synthetic completion callback step
          const resumeWithReview: MockStreamStep[] = [
            ...scenario.resumeSteps,
          ];
          pendingResumeRef.current.set(sessionId, resumeWithReview);

          // We need to handle the task → review transition after resume.
          // playScenario's last step will set status to "completed"; we
          // listen for that by scheduling the review transition after
          // the resume steps' total delay.
          // This is handled by overriding sendInput's onComplete below — 
          // but since we can't easily pass a callback through pendingResumeRef,
          // we use a separate approach: schedule a check after the resume
          // steps would complete. The longest delay in resumeSteps:
          const maxResumeDelay = resumeWithReview.reduce(
            (max, s) => Math.max(max, s.delayMs),
            0,
          );
          // We can't schedule this now because the user hasn't sent input yet.
          // Instead, we store metadata so sendInput can schedule the review
          // transition. We'll handle this by checking if the session belongs
          // to a task after resume completes.
          // For simplicity, we store the task ID alongside the resume steps
          // and handle it in sendInput via a post-resume schedule.
          pendingTaskReviewRef.current.set(sessionId, {
            taskId,
            delayAfterResume: maxResumeDelay + 200,
          });
        }
      } else {
        // Straight-through scenario: on last step, transition task to "review"
        const lastStepDelay =
          scenario.steps.length > 0
            ? scenario.steps[scenario.steps.length - 1].delayMs
            : 0;

        playScenario(sessionId, scenario.steps);

        // After scenario completes, if the session ended in "completed",
        // set task to "review". If it ended in "failed", set task to "failed".
        const finalStatus = scenario.steps[scenario.steps.length - 1]?.event.content;
        schedule(
          () => {
            if (finalStatus === "completed") {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId && t.status === "in_progress"
                    ? { ...t, status: "review" }
                    : t,
                ),
              );
            } else if (finalStatus === "failed") {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId && t.status === "in_progress"
                    ? { ...t, status: "failed" }
                    : t,
                ),
              );
            }
          },
          lastStepDelay + 100,
          sessionId,
        );
      }
    },
    [nextId, nextScenario, playScenario, schedule, updateSessionStatus, appendEvent],
  );

  /**
   * Sends input to a waiting session: echoes the user's text, transitions
   * back to "running", plays any pending resume steps, and handles
   * post-resume task → review transitions.
   */
  const sendInput: UseGrackleSocketResult["sendInput"] = useCallback(
    (sessionId: string, text: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] sendInput", { sessionId, text });

      // 1. Append echo event
      appendEvent({
        sessionId,
        eventType: "output",
        timestamp: new Date().toISOString(),
        content: `User input: ${text}`,
      });

      // 2. Transition to running
      updateSessionStatus(sessionId, "running");
      appendEvent({
        sessionId,
        eventType: "status",
        timestamp: new Date().toISOString(),
        content: "running",
      });

      // 3. Play resume steps
      const resumeSteps = pendingResumeRef.current.get(sessionId);
      if (resumeSteps) {
        pendingResumeRef.current.delete(sessionId);
        playScenario(sessionId, resumeSteps);
      } else {
        const fallbackSteps: MockStreamStep[] = [
          {
            delayMs: 500,
            event: {
              eventType: "output",
              timestamp: new Date().toISOString(),
              content: "I received your input, continuing...",
            },
          },
          {
            delayMs: 1500,
            event: {
              eventType: "status",
              timestamp: new Date().toISOString(),
              content: "completed",
            },
          },
        ];
        playScenario(sessionId, fallbackSteps);
      }

      // 4. Check for pending task review transition
      const pendingReview = pendingTaskReviewRef.current.get(sessionId);
      if (pendingReview) {
        pendingTaskReviewRef.current.delete(sessionId);
        schedule(
          () => {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === pendingReview.taskId && t.status === "in_progress"
                  ? { ...t, status: "review" }
                  : t,
              ),
            );
          },
          pendingReview.delayAfterResume,
          sessionId,
        );
      }
    },
    [appendEvent, updateSessionStatus, playScenario, schedule],
  );

  /** Approves a task: sets status to "done". */
  const approveTask: UseGrackleSocketResult["approveTask"] = useCallback(
    (taskId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] approveTask", taskId);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: "done" } : t)),
      );
    },
    [],
  );

  /** Rejects a task: sets status back to "assigned" with review notes, clears sessionId. */
  const rejectTask: UseGrackleSocketResult["rejectTask"] = useCallback(
    (taskId: string, reviewNotes: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] rejectTask", { taskId, reviewNotes });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: "assigned", reviewNotes, sessionId: "" }
            : t,
        ),
      );
    },
    [],
  );

  /** Removes a task from state. */
  const deleteTask: UseGrackleSocketResult["deleteTask"] = useCallback(
    (taskId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] deleteTask", taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    },
    [],
  );

  /** Filters findings by projectId. */
  const loadFindings: UseGrackleSocketResult["loadFindings"] = useCallback(
    (projectId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] loadFindings", projectId);
      setFindings(MOCK_FINDINGS.filter((f) => f.projectId === projectId));
    },
    [],
  );

  /** Adds a new finding to state. */
  const postFinding: UseGrackleSocketResult["postFinding"] = useCallback(
    (
      projectId: string,
      title: string,
      content: string,
      category?: string,
      tags?: string[],
    ) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] postFinding", { projectId, title });

      const newFinding: FindingData = {
        id: nextId("find"),
        projectId,
        taskId: "",
        sessionId: "",
        category: category || "general",
        title,
        content,
        tags: tags || [],
        createdAt: new Date().toISOString(),
      };

      setFindings((prev) => [...prev, newFinding]);
    },
    [nextId],
  );

  /** Logs an add-environment call (mock does not persist). */
  const addEnvironment: UseGrackleSocketResult["addEnvironment"] = useCallback(
    (
      displayName: string,
      adapterType: string,
      adapterConfig?: Record<string, unknown>,
      defaultRuntime?: string,
    ) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] addEnvironment", { displayName, adapterType, adapterConfig, defaultRuntime });
    },
    [],
  );

  /** Simulates async loading of task diff data with a short delay. */
  const loadTaskDiff: UseGrackleSocketResult["loadTaskDiff"] = useCallback(
    (taskId: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] loadTaskDiff", taskId);

      setTaskDiff(undefined);

      const handle = setTimeout(() => {
        timersRef.current.delete(handle);
        if (MOCK_TASK_DIFF.taskId === taskId) {
          setTaskDiff(MOCK_TASK_DIFF);
        } else {
          setTaskDiff({
            taskId,
            error: "No diff available for this task in mock mode.",
          });
        }
      }, LOAD_DIFF_DELAY_MS);
      timersRef.current.add(handle);
    },
    [],
  );

  // ── Token methods ──────────────────────────────────

  /** No-op — tokens are already in state from initial load. */
  const loadTokens: UseGrackleSocketResult["loadTokens"] = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log("[MockGrackle] loadTokens");
  }, []);

  /** Adds or replaces a token in state. */
  const mockSetToken: UseGrackleSocketResult["setToken"] = useCallback(
    (name: string, _value: string, tokenType: string, envVar: string, filePath: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] setToken", { name, tokenType });
      setTokens((prev) => {
        const without = prev.filter((t) => t.name !== name);
        return [...without, { name, tokenType, envVar, filePath, expiresAt: "" }];
      });
    },
    [],
  );

  /** Removes a token from state. */
  const mockDeleteToken: UseGrackleSocketResult["deleteToken"] = useCallback(
    (name: string) => {
      // eslint-disable-next-line no-console
      console.log("[MockGrackle] deleteToken", name);
      setTokens((prev) => prev.filter((t) => t.name !== name));
    },
    [],
  );

  // ── Cleanup ───────────────────────────────────────

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    };
  }, []);

  // ── Context Value ─────────────────────────────────

  const value: UseGrackleSocketResult = useMemo(
    () => ({
      // State
      connected: true,
      environments: MOCK_ENVIRONMENTS,
      sessions,
      events,
      lastSpawnedId,
      projects,
      tasks,
      findings,
      tokens,
      taskDiff,

      // Actions
      spawn,
      sendInput,
      kill,
      refresh,
      loadSessionEvents,
      clearEvents,
      createProject,
      archiveProject,
      loadTasks,
      createTask,
      startTask,
      approveTask,
      rejectTask,
      deleteTask,
      loadFindings,
      postFinding,
      loadTaskDiff,
      addEnvironment,
      loadTokens,
      setToken: mockSetToken,
      deleteToken: mockDeleteToken,
      provisionStatus: {},
      provisionEnvironment: () => {},
      stopEnvironment: () => {},
      removeEnvironment: () => {},
    }),
    [
      sessions,
      events,
      lastSpawnedId,
      projects,
      tasks,
      findings,
      tokens,
      taskDiff,
      spawn,
      sendInput,
      kill,
      refresh,
      loadSessionEvents,
      clearEvents,
      createProject,
      archiveProject,
      loadTasks,
      createTask,
      startTask,
      approveTask,
      rejectTask,
      deleteTask,
      loadFindings,
      postFinding,
      loadTaskDiff,
      addEnvironment,
      loadTokens,
      mockSetToken,
      mockDeleteToken,
    ],
  );

  return (
    <GrackleContext.Provider value={value}>{children}</GrackleContext.Provider>
  );
}
