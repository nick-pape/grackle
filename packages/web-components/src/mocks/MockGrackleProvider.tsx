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
import type { UseGrackleSocketResult } from "../context/GrackleContextTypes.js";
import type {
  Environment,
  Session,
  SessionEvent,
  FindingData,
  TaskData,
  Workspace,
  TokenInfo,
  PersonaData,
  CredentialProviderConfig,
} from "../hooks/types.js";
import { mapSessionStatus, mapEndReason } from "../hooks/types.js";
import {
  MOCK_ENVIRONMENTS,
  MOCK_SESSIONS,
  MOCK_EVENTS,
  MOCK_WORKSPACES,
  MOCK_TASKS,
  MOCK_FINDINGS,
  MOCK_TOKENS,
  MOCK_PERSONAS,
  MOCK_TASK_SESSIONS,
  MOCK_STREAM_SCENARIOS,
  MOCK_KNOWLEDGE_NODES,
  MOCK_KNOWLEDGE_LINKS,
  MOCK_KNOWLEDGE_DETAILS,
  type MockStreamStep,
} from "./mockData.js";
import type { GraphNode, GraphLink, NodeDetail } from "../hooks/types.js";

// ─── Constants ──────────────────────────────────────

/** Delay before the "idle" status is set after the last pre-pause step. */
const IDLE_DELAY_MS: number = 400;

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
  const [environments, setEnvironments] = useState<Environment[]>(MOCK_ENVIRONMENTS);
  const [sessions, setSessions] = useState<Session[]>(MOCK_SESSIONS);
  const [events, setEvents] = useState<SessionEvent[]>(MOCK_EVENTS);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | undefined>(undefined);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(MOCK_WORKSPACES);
  const [tasks, setTasks] = useState<TaskData[]>(MOCK_TASKS);
  const [findings, setFindings] = useState<FindingData[]>(MOCK_FINDINGS);
  const [selectedFinding, setSelectedFinding] = useState<FindingData | undefined>(undefined);
  const findingLoading = false;
  const [tokens, setTokens] = useState<TokenInfo[]>(MOCK_TOKENS);
  const [credentialProviders, setCredentialProviders] = useState<CredentialProviderConfig>({
    claude: "off",
    github: "off",
    copilot: "off",
    codex: "off",
    goose: "off",
  });
  const [personas, setPersonas] = useState<PersonaData[]>(MOCK_PERSONAS);
  const [taskSessions] = useState<Record<string, Session[]>>(MOCK_TASK_SESSIONS);
  const [appDefaultPersonaId, setAppDefaultPersonaIdState] = useState<string>("");

  // ── Knowledge state ────────────────────────────────
  const [knowledgeNodes, setKnowledgeNodes] = useState<GraphNode[]>(MOCK_KNOWLEDGE_NODES);
  const [knowledgeLinks, setKnowledgeLinks] = useState<GraphLink[]>(MOCK_KNOWLEDGE_LINKS);
  const [knowledgeSelectedNode, setKnowledgeSelectedNode] = useState<NodeDetail | undefined>(undefined);
  const [knowledgeSelectedId, setKnowledgeSelectedId] = useState<string | undefined>(undefined);
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState<string>("");
  /** Active workspace filter for knowledge graph. */
  const knowledgeWorkspaceRef = useRef<string | undefined>(undefined);

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

  /** Updates a single session's status (and optionally endReason) in state. */
  const updateSessionStatus = useCallback((sessionId: string, status: string, endReason?: string): void => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, status, ...(endReason !== undefined ? { endReason } : {}) } : s)),
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

            // Status events also update the session record (apply mapping
            // so raw PowerLine values like "completed"/"failed"/"killed" are
            // stored as "stopped" with the appropriate endReason).
            if (step.event.eventType === "status") {
              const mappedStatus = mapSessionStatus(step.event.content);
              const endReason = mapEndReason(step.event.content);
              updateSessionStatus(sessionId, mappedStatus, endReason);
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
    async (environmentId: string, prompt: string, _model?: string, runtime?: string) => {
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
      console.log(`[MockGrackle] Playing scenario: ${scenario.label}`);

      if (scenario.pauseForInput) {
        // Play steps up to and including pauseAfterStep, then pause
        const pauseIndex = scenario.pauseAfterStep ?? scenario.steps.length - 1;
        const preSteps = scenario.steps.slice(0, pauseIndex + 1);
        const lastStepDelay = preSteps.length > 0 ? preSteps[preSteps.length - 1].delayMs : 0;

        playScenario(sessionId, preSteps);

        // After the last pre-pause step, transition to idle
        schedule(
          () => {
            updateSessionStatus(sessionId, "idle");
            appendEvent({
              sessionId,
              eventType: "status",
              timestamp: new Date().toISOString(),
              content: "idle",
            });
          },
          lastStepDelay + IDLE_DELAY_MS,
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

  /** Kills a session: cancels timers, sets status to stopped with endReason killed, resets associated tasks. */
  const kill: UseGrackleSocketResult["kill"] = useCallback(
    async (sessionId: string) => {
      console.log("[MockGrackle] kill", sessionId);

      // 1. Cancel pending timers for this session
      cancelSessionTimers(sessionId);

      // 2. Remove any pending resume steps
      pendingResumeRef.current.delete(sessionId);

      // 3. Update session status to "stopped" with endReason "killed"
      updateSessionStatus(sessionId, "stopped", "killed");

      // 4. Append a status event
      appendEvent({
        sessionId,
        eventType: "status",
        timestamp: new Date().toISOString(),
        content: "killed",
      });

      // 5. With computed status, killing a session makes the task retryable
      // (computed back to "not_started"), so reset in-progress tasks to "not_started".
      setTasks((prev) =>
        prev.map((t) =>
          t.latestSessionId === sessionId && t.status === "working"
            ? { ...t, status: "not_started" }
            : t,
        ),
      );
    },
    [cancelSessionTimers, updateSessionStatus, appendEvent],
  );

  /** Graceful stop — mirrors kill but with "terminated" end reason. */
  const stopGraceful: UseGrackleSocketResult["stopGraceful"] = useCallback(
    async (sessionId: string) => {
      console.log("[MockGrackle] stopGraceful", sessionId);
      cancelSessionTimers(sessionId);
      pendingResumeRef.current.delete(sessionId);
      updateSessionStatus(sessionId, "stopped", "terminated");
      appendEvent({
        sessionId,
        eventType: "status",
        timestamp: new Date().toISOString(),
        content: "terminated",
      });
      // Reset tasks just like kill() — stopped sessions make tasks retryable
      setTasks((prev) =>
        prev.map((t) =>
          t.latestSessionId === sessionId && t.status === "working"
            ? { ...t, status: "not_started" }
            : t,
        ),
      );
    },
    [cancelSessionTimers, updateSessionStatus, appendEvent],
  );

  /** No-op refresh — the mock has no server to re-fetch from. */
  const refresh: UseGrackleSocketResult["refresh"] = useCallback(() => {
    console.log("[MockGrackle] refresh");
  }, []);

  /** No-op — events are already accumulated in state. */
  const loadSessionEvents: UseGrackleSocketResult["loadSessionEvents"] = useCallback(
    async (sessionId: string) => {
      console.log("[MockGrackle] loadSessionEvents", sessionId);
    },
    [],
  );

  /** Clears all events from state. */
  const clearEvents: UseGrackleSocketResult["clearEvents"] = useCallback(() => {
    console.log("[MockGrackle] clearEvents");
    setEvents([]);
  }, []);

  /** Creates a new workspace and adds it to state. */
  const createWorkspace: UseGrackleSocketResult["createWorkspace"] = useCallback(
    async (
      name: string,
      description?: string,
      repoUrl?: string,
      environmentId?: string,
      defaultPersonaId?: string,
      useWorktrees?: boolean,
      workingDirectory?: string,
      onSuccess?: () => void,
      _onError?: (message: string) => void,
    ) => {
      console.log("[MockGrackle] createWorkspace", { name, description });

      const newWorkspace: Workspace = {
        id: nextId("proj"),
        name,
        description: description || "",
        repoUrl: repoUrl || "",
        environmentId: environmentId || "",
        status: "active",
        workingDirectory: workingDirectory || "",
        useWorktrees: useWorktrees ?? true,
        defaultPersonaId: defaultPersonaId || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setWorkspaces((prev) => [...prev, newWorkspace]);
      if (onSuccess) {
        onSuccess();
      }
    },
    [nextId],
  );

  /** Sets a workspace's status to "archived". */
  const archiveWorkspace: UseGrackleSocketResult["archiveWorkspace"] = useCallback(
    async (workspaceId: string) => {
      console.log("[MockGrackle] archiveWorkspace", workspaceId);
      setWorkspaces((prev) =>
        prev.map((p) => (p.id === workspaceId ? { ...p, status: "archived" } : p)),
      );
    },
    [],
  );

  /** No-op — tasks are already in state from initial load. */
  const loadTasks: UseGrackleSocketResult["loadTasks"] = useCallback(
    async (workspaceId: string) => {
      console.log("[MockGrackle] loadTasks", workspaceId);
    },
    [],
  );

  /** Creates a new task and adds it to state. */
  const createTask: UseGrackleSocketResult["createTask"] = useCallback(
    async (
      workspaceId: string,
      title: string,
      description?: string,
      dependsOn?: string[],
      parentTaskId?: string,
      defaultPersonaId?: string,
      canDecompose?: boolean,
      onSuccess?: () => void,
      _onError?: (message: string) => void,
    ) => {
      console.log("[MockGrackle] createTask", { workspaceId, title, parentTaskId });

      setTasks((prev) => {
        const wsTasks = prev.filter((t) => t.workspaceId === workspaceId);
        const maxSort = wsTasks.reduce((max, t) => Math.max(max, t.sortOrder), 0);
        const parent = parentTaskId ? prev.find((t) => t.id === parentTaskId) : undefined;
        if (parentTaskId && !parent) {
          console.warn("[MockGrackle] Parent task not found:", parentTaskId);
          return prev;
        }
        if (parent && !parent.canDecompose) {
          console.warn("[MockGrackle] Parent task does not have decomposition rights:", parentTaskId);
          return prev;
        }
        const depth = parent ? parent.depth + 1 : 0;

        const newTask: TaskData = {
          id: nextId("task"),
          workspaceId,
          title,
          description: description || "",
          status: "not_started",
          branch: "",
          latestSessionId: "",
          dependsOn: dependsOn || [],
          reviewNotes: undefined,
          sortOrder: maxSort + 1,
          createdAt: new Date().toISOString(),
          parentTaskId: parentTaskId || "",
          depth,
          childTaskIds: [],
          canDecompose: canDecompose ?? !parentTaskId,
          defaultPersonaId: defaultPersonaId || "",
          workpad: "",
        };

        return [...prev, newTask];
      });
      if (onSuccess) {
        onSuccess();
      }
    },
    [nextId],
  );

  /**
   * Starts a task: creates a new session, links it to the task, sets the
   * task to "working", and plays a stream scenario. On scenario
   * completion, transitions the task to "paused".
   *
   * Also handles retry from "failed" — the task gets a fresh session.
   */
  const startTask: UseGrackleSocketResult["startTask"] = useCallback(
    async (taskId: string, _personaId?: string, _environmentId?: string, _notes?: string) => {
      console.log("[MockGrackle] startTask", { taskId });

      // Find the task to get its metadata
      const target = tasksRef.current.find((t) => t.id === taskId);
      const taskTitle = target?.title ?? "";

      const sessionId = nextId("sess");
      const newSession: Session = {
        id: sessionId,
        environmentId: "env-local-01",
        runtime: "claude-code",
        status: "running",
        prompt: taskTitle || taskId,
        startedAt: new Date().toISOString(),
      };

      setSessions((prev) => [...prev, newSession]);

      // Update task: status → "working", latestSessionId → new session, branch → mock branch
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
              ...t,
              status: "working",
              latestSessionId: sessionId,
              branch: `mock/${taskId.slice(0, 8)}`,
            }
            : t,
        ),
      );

      // Pick and play a scenario
      const scenario = nextScenario();
      console.log(`[MockGrackle] Playing task scenario: ${scenario.label}`);

      if (scenario.pauseForInput) {
        const pauseIndex = scenario.pauseAfterStep ?? scenario.steps.length - 1;
        const preSteps = scenario.steps.slice(0, pauseIndex + 1);
        const lastStepDelay = preSteps.length > 0 ? preSteps[preSteps.length - 1].delayMs : 0;

        playScenario(sessionId, preSteps);

        schedule(
          () => {
            updateSessionStatus(sessionId, "idle");
            appendEvent({
              sessionId,
              eventType: "status",
              timestamp: new Date().toISOString(),
              content: "idle",
            });
          },
          lastStepDelay + IDLE_DELAY_MS,
          sessionId,
        );

        // Store resume steps; on resume completion, transition task to "paused"
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
        // Straight-through scenario: on last step, transition task to "paused"
        const lastStepDelay =
          scenario.steps.length > 0
            ? scenario.steps[scenario.steps.length - 1].delayMs
            : 0;

        playScenario(sessionId, scenario.steps);

        // After scenario completes, if the session ended in "completed",
        // set task to "paused". If it ended in "failed", set task to "failed".
        const finalStatus = scenario.steps[scenario.steps.length - 1]?.event.content;
        schedule(
          () => {
            if (finalStatus === "completed") {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId && t.status === "working"
                    ? { ...t, status: "paused" }
                    : t,
                ),
              );
            } else if (finalStatus === "failed") {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId && t.status === "working"
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
    async (sessionId: string, text: string) => {
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
                t.id === pendingReview.taskId && t.status === "working"
                  ? { ...t, status: "paused" }
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

  /** Completes a task: sets status to "complete" (human-authoritative). */
  const completeTask: UseGrackleSocketResult["completeTask"] = useCallback(
    async (taskId: string) => {
      console.log("[MockGrackle] completeTask", taskId);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: "complete" } : t)),
      );
    },
    [],
  );

  /** Resumes the latest session for a task (mock: no-op, just logs). */
  const resumeTask: UseGrackleSocketResult["resumeTask"] = useCallback(
    async (taskId: string) => {
      console.log("[MockGrackle] resumeTask", taskId);
    },
    [],
  );

  /** Updates title, description, dependencies, and default persona of a pending/assigned task. */
  const updateTask: UseGrackleSocketResult["updateTask"] = useCallback(
    async (
      taskId: string,
      title: string,
      description: string,
      dependsOn: string[],
      defaultPersonaId?: string,
    ) => {
      console.log("[MockGrackle] updateTask", { taskId, title });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                title: title.trim() || t.title,
                description,
                dependsOn,
                ...(defaultPersonaId !== undefined ? { defaultPersonaId } : {}),
              }
            : t,
        ),
      );
    },
    [],
  );

  /** Removes a task from state. */
  const deleteTask: UseGrackleSocketResult["deleteTask"] = useCallback(
    async (taskId: string) => {
      console.log("[MockGrackle] deleteTask", taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    },
    [],
  );

  /** Filters findings by workspaceId. */
  const loadFindings: UseGrackleSocketResult["loadFindings"] = useCallback(
    async (workspaceId: string) => {
      console.log("[MockGrackle] loadFindings", workspaceId);
      setFindings(MOCK_FINDINGS.filter((f) => f.workspaceId === workspaceId));
    },
    [],
  );

  /** Load all findings across all workspaces. */
  const loadAllFindings: UseGrackleSocketResult["loadAllFindings"] = useCallback(async () => {
    console.log("[MockGrackle] loadAllFindings");
    setFindings([...MOCK_FINDINGS]);
  }, []);

  /** Load a single finding by ID. */
  const loadFinding: UseGrackleSocketResult["loadFinding"] = useCallback(
    async (findingId: string) => {
      console.log("[MockGrackle] loadFinding", findingId);
      const found = MOCK_FINDINGS.find((f) => f.id === findingId);
      setSelectedFinding(found);
    },
    [],
  );

  /** Adds a new finding to state. */
  const postFinding: UseGrackleSocketResult["postFinding"] = useCallback(
    async (
      workspaceId: string,
      title: string,
      content: string,
      category?: string,
      tags?: string[],
    ) => {
      console.log("[MockGrackle] postFinding", { workspaceId, title });

      const newFinding: FindingData = {
        id: nextId("find"),
        workspaceId,
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

  /** No-op in mock mode (environments are pre-seeded). */
  const loadEnvironments: UseGrackleSocketResult["loadEnvironments"] = useCallback(async () => {
    console.log("[MockGrackle] loadEnvironments");
  }, []);

  /** Logs an add-environment call (mock does not persist). */
  const addEnvironment: UseGrackleSocketResult["addEnvironment"] = useCallback(
    async (
      displayName: string,
      adapterType: string,
      adapterConfig?: Record<string, unknown>,
    ) => {
      console.log("[MockGrackle] addEnvironment", { displayName, adapterType, adapterConfig });
    },
    [],
  );

  /** Updates an environment in mock state so edits persist in mock mode. */
  const updateEnvironment: UseGrackleSocketResult["updateEnvironment"] = useCallback(
    async (
      environmentId: string,
      fields: { displayName?: string; adapterConfig?: Record<string, unknown> },
    ) => {
      console.log("[MockGrackle] updateEnvironment", { environmentId, ...fields });
      setEnvironments((prev) =>
        prev.map((env) => {
          if (env.id !== environmentId) {
            return env;
          }
          return {
            ...env,
            ...(fields.displayName !== undefined ? { displayName: fields.displayName } : {}),
            ...(fields.adapterConfig !== undefined
              ? { adapterConfig: JSON.stringify(fields.adapterConfig) }
              : {}),
          };
        }),
      );
    },
    [],
  );

  // ── Token methods ──────────────────────────────────

  /** No-op — tokens are already in state from initial load. */
  const loadTokens: UseGrackleSocketResult["loadTokens"] = useCallback(async () => {
    console.log("[MockGrackle] loadTokens");
  }, []);

  /** Adds or replaces a token in state. */
  const mockSetToken: UseGrackleSocketResult["setToken"] = useCallback(
    async (name: string, _value: string, tokenType: string, envVar: string, filePath: string) => {
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
    async (name: string) => {
      console.log("[MockGrackle] deleteToken", name);
      setTokens((prev) => prev.filter((t) => t.name !== name));
    },
    [],
  );

  /** Updates credential provider configuration in state. */
  const mockUpdateCredentialProviders: UseGrackleSocketResult["updateCredentialProviders"] = useCallback(
    async (config: CredentialProviderConfig) => {
      console.log("[MockGrackle] updateCredentialProviders", config);
      setCredentialProviders(config);
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
      send: () => {},
      environments,
      sessions,
      events,
      eventsDropped: 0,
      lastSpawnedId,
      workspaces,
      tasks,
      findings,
      selectedFinding,
      findingLoading,
      tokens,
      credentialProviders,

      // Actions
      spawn,
      sendInput,
      kill,
      stopGraceful,
      refresh,
      loadSessionEvents,
      clearEvents,
      loadWorkspaces: async () => { console.log("[MockGrackle] loadWorkspaces"); },
      createWorkspace,
      archiveWorkspace,
      updateWorkspace: async (workspaceId: string, fields: { name?: string; description?: string; repoUrl?: string; environmentId?: string; workingDirectory?: string; useWorktrees?: boolean; defaultPersonaId?: string }) => {
        console.log("[MockGrackle] updateWorkspace", { workspaceId, ...fields });
        setWorkspaces((prev) =>
          prev.map((p) => {
            if (p.id !== workspaceId) {
              return p;
            }
            return {
              ...p,
              ...(fields.name !== undefined ? { name: fields.name } : {}),
              ...(fields.description !== undefined ? { description: fields.description } : {}),
              ...(fields.repoUrl !== undefined ? { repoUrl: fields.repoUrl } : {}),
              ...(fields.environmentId !== undefined ? { environmentId: fields.environmentId } : {}),
              ...(fields.workingDirectory !== undefined ? { workingDirectory: fields.workingDirectory } : {}),
              ...(fields.useWorktrees !== undefined ? { useWorktrees: fields.useWorktrees } : {}),
              ...(fields.defaultPersonaId !== undefined ? { defaultPersonaId: fields.defaultPersonaId } : {}),
              updatedAt: new Date().toISOString(),
            };
          }),
        );
      },
      loadTasks,
      loadAllTasks: async () => {
        console.log("[MockGrackle] loadAllTasks");
      },
      createTask,
      startTask,
      stopTask: async (taskId: string) => {
        console.log("[MockGrackle] stopTask", { taskId });
        await completeTask(taskId);
      },
      completeTask,
      resumeTask,
      updateTask,
      deleteTask,
      loadFindings,
      loadAllFindings,
      loadFinding,
      postFinding,
      loadEnvironments,
      addEnvironment,
      updateEnvironment,
      loadTokens,
      setToken: mockSetToken,
      deleteToken: mockDeleteToken,
      updateCredentialProviders: mockUpdateCredentialProviders,
      provisionStatus: {},
      provisionEnvironment: async (_environmentId: string, _force?: boolean) => { },
      stopEnvironment: async () => { },
      removeEnvironment: async () => { },
      codespaces: [],
      codespaceError: "",
      codespaceListError: "",
      codespaceCreating: false,
      listCodespaces: async () => { },
      createCodespace: async () => { },
      workspaceCreating: false,
      taskStartingId: undefined,
      personas,
      createPersona: async (name: string, description: string, systemPrompt: string, runtime?: string, model?: string, maxTurns?: number, type?: string, script?: string, allowedMcpTools?: string[]) => {
        console.log("[MockGrackle] createPersona", { name });
        const newPersona: PersonaData = {
          id: `mock-persona-${Date.now()}`,
          name,
          description,
          systemPrompt,
          toolConfig: "{}",
          runtime: runtime ?? "claude-code",
          model: model || "",
          maxTurns: maxTurns || 0,
          mcpServers: "[]",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          type: type || "agent",
          script: script || "",
          allowedMcpTools: allowedMcpTools || [],
        };
        setPersonas((prev) => [...prev, newPersona]);
        return newPersona;
      },
      updatePersona: async (personaId: string, name?: string, description?: string, systemPrompt?: string, runtime?: string, model?: string, maxTurns?: number, type?: string, script?: string, allowedMcpTools?: string[]) => {
        console.log("[MockGrackle] updatePersona", { personaId, name });
        const existingPersona = personas.find((persona) => persona.id === personaId);
        if (!existingPersona) {
          throw new Error(`Persona not found: ${personaId}`);
        }

        const updatedAt = new Date().toISOString();
        const updatedPersona: PersonaData = {
          ...existingPersona,
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(systemPrompt !== undefined ? { systemPrompt } : {}),
          ...(runtime !== undefined ? { runtime } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(maxTurns !== undefined ? { maxTurns } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(script !== undefined ? { script } : {}),
          ...(allowedMcpTools !== undefined ? { allowedMcpTools } : {}),
          updatedAt,
        };

        setPersonas((prev) =>
          prev.map((persona) => (persona.id === personaId ? updatedPersona : persona)),
        );
        return updatedPersona;
      },
      deletePersona: async (personaId: string) => {
        console.log("[MockGrackle] deletePersona", personaId);
        setPersonas((prev) => prev.filter((p) => p.id !== personaId));
      },
      taskSessions,
      loadTaskSessions: async (taskId: string) => {
        console.log("[MockGrackle] loadTaskSessions", taskId);
      },
      appDefaultPersonaId,
      setAppDefaultPersonaId: async (personaId: string) => {
        console.log("[MockGrackle] setAppDefaultPersonaId", personaId);
        setAppDefaultPersonaIdState(personaId);
      },
      onboardingCompleted: true,
      completeOnboarding: async () => {
        console.log("[MockGrackle] completeOnboarding");
      },
      usageCache: {
        "workspace:proj-alpha": { inputTokens: 214_500, outputTokens: 44_850, costUsd: 1.12, sessionCount: 4 },
        "workspace:proj-beta": { inputTokens: 86_700, outputTokens: 23_800, costUsd: 0.48, sessionCount: 3 },
        "task:task-001": { inputTokens: 126_800, outputTokens: 20_850, costUsd: 0.63, sessionCount: 2 },
        "task:task-006": { inputTokens: 18_900, outputTokens: 4_500, costUsd: 0.10, sessionCount: 1 },
        "task_tree:task-001": { inputTokens: 126_800, outputTokens: 20_850, costUsd: 0.63, sessionCount: 2 },
        "task_tree:task-006": { inputTokens: 18_900, outputTokens: 4_500, costUsd: 0.10, sessionCount: 1 },
      },
      loadUsage: async (scope: string, id: string) => {
        console.log(`[MockGrackle] loadUsage(${scope}, ${id})`);
      },
      knowledge: {
        graphData: { nodes: knowledgeNodes, links: knowledgeLinks },
        selectedNode: knowledgeSelectedNode,
        loading: false,
        selectedId: knowledgeSelectedId,
        searchQuery: knowledgeSearchQuery,
        search: async (query: string) => {
          console.log("[MockGrackle] knowledge.search", query);
          if (!query.trim()) {
            setKnowledgeSearchQuery(query);
            return;
          }
          setKnowledgeSearchQuery(query);
          // Start from workspace-scoped base set, not the full graph
          const wsId = knowledgeWorkspaceRef.current;
          const baseNodes = wsId
            ? MOCK_KNOWLEDGE_NODES.filter((n) => !n.workspaceId || n.workspaceId === wsId)
            : MOCK_KNOWLEDGE_NODES;
          const lowerQuery = query.toLowerCase();
          const filtered = baseNodes.filter((n) =>
            n.label.toLowerCase().includes(lowerQuery)
            || n.content?.toLowerCase().includes(lowerQuery)
            || n.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
            || n.category?.toLowerCase().includes(lowerQuery),
          );
          setKnowledgeNodes(filtered);
          const nodeIds = new Set(filtered.map((n) => n.id));
          setKnowledgeLinks(
            MOCK_KNOWLEDGE_LINKS.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)),
          );
          setKnowledgeSelectedId(undefined);
          setKnowledgeSelectedNode(undefined);
        },
        clearSearch: () => {
          console.log("[MockGrackle] knowledge.clearSearch");
          setKnowledgeSearchQuery("");
          // Restore to workspace-scoped base set, not the full graph
          const wsId = knowledgeWorkspaceRef.current;
          const baseNodes = wsId
            ? MOCK_KNOWLEDGE_NODES.filter((n) => !n.workspaceId || n.workspaceId === wsId)
            : MOCK_KNOWLEDGE_NODES;
          setKnowledgeNodes(baseNodes);
          const nodeIds = new Set(baseNodes.map((n) => n.id));
          setKnowledgeLinks(
            MOCK_KNOWLEDGE_LINKS.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)),
          );
        },
        selectNode: async (id: string) => {
          console.log("[MockGrackle] knowledge.selectNode", id);
          setKnowledgeSelectedId(id);
          const detail: NodeDetail | undefined = id in MOCK_KNOWLEDGE_DETAILS
            ? MOCK_KNOWLEDGE_DETAILS[id]
            : undefined;
          if (detail) {
            setKnowledgeSelectedNode(detail);
          } else {
            // Build a detail from the node and its edges
            const node = MOCK_KNOWLEDGE_NODES.find((n) => n.id === id);
            if (node) {
              const edges = MOCK_KNOWLEDGE_LINKS
                .filter((l) => l.source === id || l.target === id)
                .map((l) => ({ fromId: l.source, toId: l.target, type: l.type }));
              setKnowledgeSelectedNode({ node, edges });
            }
          }
        },
        clearSelection: () => {
          console.log("[MockGrackle] knowledge.clearSelection");
          setKnowledgeSelectedId(undefined);
          setKnowledgeSelectedNode(undefined);
        },
        expandNode: async (id: string) => {
          console.log("[MockGrackle] knowledge.expandNode", id);
          // Use functional updaters to avoid stale closure over knowledgeNodes/knowledgeLinks
          setKnowledgeNodes((prevNodes) => {
            const currentIds = new Set(prevNodes.map((n) => n.id));
            const connectedLinks = MOCK_KNOWLEDGE_LINKS.filter(
              (l) => l.source === id || l.target === id,
            );
            const newNodeIds = new Set<string>();
            for (const link of connectedLinks) {
              if (!currentIds.has(link.source)) { newNodeIds.add(link.source); }
              if (!currentIds.has(link.target)) { newNodeIds.add(link.target); }
            }
            if (newNodeIds.size === 0) {
              return prevNodes;
            }
            const newNodes = MOCK_KNOWLEDGE_NODES.filter((n) => newNodeIds.has(n.id));
            const allIds = new Set([...currentIds, ...newNodeIds]);
            // Update links inside its own functional updater using the computed allIds
            setKnowledgeLinks((prevLinks) => {
              const existingSet = new Set(prevLinks.map((l) => `${l.source}|${l.target}|${l.type}`));
              const newLinks = MOCK_KNOWLEDGE_LINKS.filter(
                (l) => allIds.has(l.source) && allIds.has(l.target)
                  && !existingSet.has(`${l.source}|${l.target}|${l.type}`),
              );
              return newLinks.length > 0 ? [...prevLinks, ...newLinks] : prevLinks;
            });
            return [...prevNodes, ...newNodes];
          });
        },
        loadRecent: async (workspaceId?: string) => {
          console.log("[MockGrackle] knowledge.loadRecent", workspaceId);
          knowledgeWorkspaceRef.current = workspaceId;
          if (workspaceId) {
            const filtered = MOCK_KNOWLEDGE_NODES.filter(
              (n) => !n.workspaceId || n.workspaceId === workspaceId,
            );
            setKnowledgeNodes(filtered);
            const nodeIds = new Set(filtered.map((n) => n.id));
            setKnowledgeLinks(
              MOCK_KNOWLEDGE_LINKS.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)),
            );
          } else {
            setKnowledgeNodes(MOCK_KNOWLEDGE_NODES);
            setKnowledgeLinks(MOCK_KNOWLEDGE_LINKS);
          }
          setKnowledgeSearchQuery("");
        },
        handleEvent: () => false,
      },
    }),
    [
      environments,
      sessions,
      events,
      lastSpawnedId,
      workspaces,
      tasks,
      findings,
      selectedFinding,
      tokens,
      credentialProviders,
      personas,
      taskSessions,
      appDefaultPersonaId,
      knowledgeNodes,
      knowledgeLinks,
      knowledgeSelectedNode,
      knowledgeSelectedId,
      knowledgeSearchQuery,
      spawn,
      sendInput,
      kill,
      stopGraceful,
      refresh,
      loadSessionEvents,
      clearEvents,
      createWorkspace,
      archiveWorkspace,
      loadTasks,
      createTask,
      startTask,
      completeTask,
      resumeTask,
      updateTask,
      deleteTask,
      loadFindings,
      loadAllFindings,
      loadFinding,
      postFinding,
      loadEnvironments,
      addEnvironment,
      updateEnvironment,
      loadTokens,
      mockSetToken,
      mockDeleteToken,
      mockUpdateCredentialProviders,
    ],
  );

  return (
    <GrackleContext.Provider value={value}>{children}</GrackleContext.Provider>
  );
}
