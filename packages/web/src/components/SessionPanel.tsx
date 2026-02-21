import { useGrackle } from "../context/GrackleContext.js";
import { EventRenderer } from "./EventRenderer.js";
import { DiffViewer } from "./DiffViewer.js";
import { FindingsPanel } from "./FindingsPanel.js";
import { useEffect, useRef, useState } from "react";
import type { ViewMode } from "../App.js";
import type { Session, SessionEvent } from "../hooks/useGrackleSocket.js";

interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

// --- Subcomponents ---

interface SessionHeaderProps {
  sessionId: string;
  session: Session | null;
  isActive: boolean;
  onKill: (sessionId: string) => void;
}

function SessionHeader({ sessionId, session, isActive, onKill }: SessionHeaderProps) {
  return (
    <div
      style={{
        padding: "6px 12px",
        borderBottom: "1px solid #0f3460",
        fontSize: "12px",
        color: "#a0a0a0",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>
        Session: {sessionId.slice(0, 8)}
        {session && ` | ${session.runtime} | ${session.status}`}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {session && (
          <span>{session.prompt.length > 60 ? session.prompt.slice(0, 60) + "..." : session.prompt}</span>
        )}
        {isActive && (
          <button
            onClick={() => onKill(sessionId)}
            title="Stop session"
            style={{
              background: "none",
              border: "1px solid #e94560",
              color: "#e94560",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "11px",
              padding: "1px 6px",
              fontFamily: "monospace",
            }}
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

interface EventListProps {
  sessionEvents: SessionEvent[];
  session: Session | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

function EventList({ sessionEvents, session, scrollRef }: EventListProps) {
  const isTerminal = session && ["completed", "failed", "killed"].includes(session.status);
  const emptyMessage = isTerminal
    ? `Session ${session.status} with no events recorded.`
    : "Waiting for events...";

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflow: "auto",
        padding: "12px",
      }}
    >
      {sessionEvents.length === 0 && (
        <div style={{ color: isTerminal ? "#e94560" : "#666" }}>{emptyMessage}</div>
      )}
      {sessionEvents.map((event, i) => (
        <EventRenderer key={i} event={event} />
      ))}
    </div>
  );
}

// --- Main component ---

type TaskTab = "stream" | "diff" | "findings";

export function SessionPanel({ viewMode, setViewMode }: Props) {
  const { events, sessions, tasks, findings, taskDiff, loadSessionEvents, loadFindings, loadTaskDiff, kill } = useGrackle();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<string | null>(null);
  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>("stream");

  // Determine session context
  let sessionId: string | null = null;
  let task: ReturnType<typeof tasks.find> = undefined;
  let projectId: string | null = null;

  if (viewMode.kind === "session") {
    sessionId = viewMode.sessionId;
  } else if (viewMode.kind === "task") {
    task = tasks.find((t) => t.id === viewMode.taskId);
    sessionId = task?.sessionId || null;
    projectId = task?.projectId || null;
    // Use the tab from viewMode if specified
    if (viewMode.tab && viewMode.tab !== activeTaskTab) {
      // Will be set via effect
    }
  }

  const sessionEvents = sessionId
    ? events.filter((e) => e.sessionId === sessionId)
    : [];

  const session = sessionId
    ? sessions.find((s) => s.id === sessionId) ?? null
    : null;

  // Auto-switch to diff tab when task enters review
  useEffect(() => {
    if (task?.status === "review") {
      setActiveTaskTab("diff");
    }
  }, [task?.status]);

  // Sync tab from viewMode
  useEffect(() => {
    if (viewMode.kind === "task" && viewMode.tab) {
      setActiveTaskTab(viewMode.tab);
    }
  }, [viewMode]);

  // Load historical events when selecting a session
  useEffect(() => {
    if (sessionId && sessionId !== loadedRef.current) {
      loadedRef.current = sessionId;
      loadSessionEvents(sessionId);
    }
  }, [sessionId, loadSessionEvents]);

  // Load findings/diff when switching tabs
  useEffect(() => {
    if (activeTaskTab === "findings" && projectId) {
      loadFindings(projectId);
    }
    if (activeTaskTab === "diff" && task?.id) {
      loadTaskDiff(task.id);
    }
  }, [activeTaskTab, projectId, task?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && activeTaskTab === "stream") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionEvents.length, activeTaskTab]);

  // --- empty mode ---
  if (viewMode.kind === "empty") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
        Select a session, project, or task to get started
      </div>
    );
  }

  // --- new_chat mode ---
  if (viewMode.kind === "new_chat") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
        Enter a prompt below to start a new session
      </div>
    );
  }

  // --- project mode ---
  if (viewMode.kind === "project") {
    const projectTasks = tasks.filter((t) => t.projectId === viewMode.projectId);
    const done = projectTasks.filter((t) => t.status === "done").length;
    const total = projectTasks.length;
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", flexDirection: "column", gap: "8px" }}>
        <span style={{ fontSize: "16px" }}>
          {total > 0 ? `${done}/${total} tasks complete` : "No tasks yet"}
        </span>
        <span style={{ fontSize: "12px" }}>Select a task or click + to create one</span>
      </div>
    );
  }

  // --- new_task mode ---
  if (viewMode.kind === "new_task") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
        Fill in the task details below
      </div>
    );
  }

  // --- task mode ---
  if (viewMode.kind === "task") {
    const isActive = session?.status === "running" || session?.status === "waiting_input";

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Task header */}
        <div
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid #0f3460",
            fontSize: "12px",
            color: "#a0a0a0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Task: {task?.title || viewMode.taskId}
            {task && ` | ${task.status}`}
            {task?.branch && ` | ${task.branch}`}
          </span>
          {isActive && (
            <button
              onClick={() => sessionId && kill(sessionId)}
              title="Stop session"
              style={{
                background: "none",
                border: "1px solid #e94560",
                color: "#e94560",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "11px",
                padding: "1px 6px",
                fontFamily: "monospace",
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid #0f3460" }}>
          <TaskTabButton active={activeTaskTab === "stream"} onClick={() => setActiveTaskTab("stream")}>
            Stream
          </TaskTabButton>
          <TaskTabButton active={activeTaskTab === "diff"} onClick={() => setActiveTaskTab("diff")}>
            Diff
          </TaskTabButton>
          <TaskTabButton active={activeTaskTab === "findings"} onClick={() => setActiveTaskTab("findings")}>
            Findings
          </TaskTabButton>
        </div>

        {/* Tab content */}
        {activeTaskTab === "stream" && (
          <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "12px" }}>
            {!sessionId && (
              <div style={{ color: "#666" }}>Task has not been started yet</div>
            )}
            {sessionId && sessionEvents.length === 0 && (
              <div style={{ color: "#666" }}>Waiting for events...</div>
            )}
            {sessionEvents.map((event, i) => (
              <EventRenderer key={i} event={event} />
            ))}
          </div>
        )}

        {activeTaskTab === "diff" && (
          <div style={{ flex: 1, overflow: "auto" }}>
            <DiffViewer diff={taskDiff} />
          </div>
        )}

        {activeTaskTab === "findings" && (
          <div style={{ flex: 1, overflow: "auto" }}>
            {projectId ? (
              <FindingsPanel projectId={projectId} />
            ) : (
              <div style={{ padding: "24px", color: "#666", textAlign: "center" }}>
                No project context
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- session mode (legacy/direct) ---
  const isActive = session?.status === "running" || session?.status === "waiting_input";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <SessionHeader
        sessionId={sessionId!}
        session={session}
        isActive={isActive}
        onKill={kill}
      />
      <EventList
        sessionEvents={sessionEvents}
        session={session}
        scrollRef={scrollRef}
      />
    </div>
  );
}

function TaskTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px",
        background: active ? "#0f3460" : "transparent",
        border: "none",
        color: active ? "#4ecca3" : "#888",
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: "11px",
        borderBottom: active ? "2px solid #4ecca3" : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
