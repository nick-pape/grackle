// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { AgentManager, isImageAvatar } from "./AgentManager.js";
import type { AgentData, PersonaData } from "../../hooks/types.js";

const AGENTS: AgentData[] = [
  { id: "refactor-bot", name: "Refactor Bot", avatar: "B", primaryPersonaId: "claude-code" },
  { id: "doc-writer", name: "Doc Writer", avatar: "D", primaryPersonaId: "" },
];

const PERSONAS: PersonaData[] = [
  {
    id: "claude-code",
    name: "Software Engineer",
    description: "",
    systemPrompt: "",
    toolConfig: "{}",
    runtime: "claude-code",
    model: "sonnet",
    maxTurns: 0,
    mcpServers: "[]",
    type: "agent",
    script: "",
    allowedMcpTools: [],
    createdAt: "",
    updatedAt: "",
  },
];

const NOOP = (): void => {};
const NOOP_CREATE = (_n: string, _a: string, _p: string): void => {};
const NOOP_DELETE = (_id: string): void => {};

describe("isImageAvatar", () => {
  it("accepts http(s) URLs", () => {
    expect(isImageAvatar("https://example.com/a.png")).toBe(true);
    expect(isImageAvatar("http://example.com/a.png")).toBe(true);
  });

  it("accepts root-relative paths but rejects protocol-relative URLs", () => {
    expect(isImageAvatar("/static/a.png")).toBe(true);
    expect(isImageAvatar("//evil.example/a.png")).toBe(false);
  });

  it("accepts safe data: image MIME types", () => {
    expect(isImageAvatar("data:image/png;base64,AAA")).toBe(true);
    expect(isImageAvatar("data:image/jpeg;base64,AAA")).toBe(true);
    expect(isImageAvatar("data:image/gif;base64,AAA")).toBe(true);
    expect(isImageAvatar("data:image/webp;base64,AAA")).toBe(true);
  });

  it("rejects data:text/html and data:image/svg+xml (script-capable)", () => {
    expect(isImageAvatar("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isImageAvatar("data:image/svg+xml;base64,AAA")).toBe(false);
  });

  it("rejects bare strings (emoji, monogram, junk)", () => {
    expect(isImageAvatar("B")).toBe(false);
    expect(isImageAvatar("🐦")).toBe(false);
    // eslint-disable-next-line no-script-url -- this is the value we're proving gets REJECTED
    expect(isImageAvatar("javascript:alert(1)")).toBe(false);
    expect(isImageAvatar("")).toBe(false);
  });
});

describe("AgentManager", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the read-only view for a known agent", () => {
    render(
      <AgentManager
        agents={AGENTS}
        personas={PERSONAS}
        agentId="refactor-bot"
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-view")).toBeTruthy();
    expect(screen.getByTestId("agent-name").textContent).toBe("Refactor Bot");
    expect(screen.getByTestId("agent-persona").textContent).toBe("Software Engineer");
    expect(screen.getByTestId("agent-history")).toBeTruthy();
  });

  it("falls back to the raw persona id when the persona is unknown", () => {
    render(
      <AgentManager
        agents={AGENTS}
        personas={[]}
        agentId="refactor-bot"
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-persona").textContent).toBe("claude-code");
  });

  it("renders '(none)' when the agent has no primary persona", () => {
    render(
      <AgentManager
        agents={AGENTS}
        personas={PERSONAS}
        agentId="doc-writer"
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-persona").textContent).toBe("(none)");
  });

  it("renders the create form when no agentId is provided", () => {
    render(
      <AgentManager
        agents={AGENTS}
        personas={PERSONAS}
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-create-form")).toBeTruthy();
    expect(screen.getByTestId("agent-name-input")).toBeTruthy();
    expect(screen.getByTestId("agent-avatar-input")).toBeTruthy();
    expect(screen.getByTestId("agent-persona-select")).toBeTruthy();
    // Submit is disabled until the user types a name.
    const submit = screen.getByTestId("agent-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables submit once the user types a name and emits the trimmed values", () => {
    const onCreate = vi.fn();
    render(
      <AgentManager
        agents={[]}
        personas={PERSONAS}
        onCreate={onCreate}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    const name = screen.getByTestId("agent-name-input") as HTMLInputElement;
    const avatar = screen.getByTestId("agent-avatar-input") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  New Bot  " } });
    fireEvent.change(avatar, { target: { value: "  X  " } });
    const submit = screen.getByTestId("agent-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onCreate).toHaveBeenCalledWith("New Bot", "X", "");
  });

  it("renders the not-found view when agentId is set but missing from agents", () => {
    render(
      <AgentManager
        agents={AGENTS}
        personas={PERSONAS}
        agentId="ghost"
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-not-found")).toBeTruthy();
    // Back button is the only action.
    expect(screen.getByTestId("agent-back")).toBeTruthy();
  });

  it("renders the loading placeholder while agents are still loading", () => {
    render(
      <AgentManager
        agents={[]}
        personas={PERSONAS}
        agentId="loading-bot"
        agentsLoading
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-loading")).toBeTruthy();
    // Neither not-found nor create form should be present.
    expect(screen.queryByTestId("agent-not-found")).toBeNull();
    expect(screen.queryByTestId("agent-create-form")).toBeNull();
  });

  it("renders an inline glyph for emoji avatars and an <img> for URL avatars", () => {
    const { rerender } = render(
      <AgentManager
        agents={[{ id: "a", name: "Emoji", avatar: "🐦", primaryPersonaId: "" }]}
        personas={[]}
        agentId="a"
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-avatar-glyph").textContent).toBe("🐦");

    rerender(
      <AgentManager
        agents={[{ id: "a", name: "Url", avatar: "https://x.test/a.png", primaryPersonaId: "" }]}
        personas={[]}
        agentId="a"
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    const img = screen.getByTestId("agent-avatar-image") as HTMLImageElement;
    expect(img.tagName.toLowerCase()).toBe("img");
    expect(img.getAttribute("src")).toBe("https://x.test/a.png");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("falls back to a monogram derived from the name when avatar is empty", () => {
    render(
      <AgentManager
        agents={[{ id: "a", name: "monica", avatar: "", primaryPersonaId: "" }]}
        personas={[]}
        agentId="a"
        onCreate={NOOP_CREATE}
        onDelete={NOOP_DELETE}
        onNavigateBack={NOOP}
      />,
    );
    expect(screen.getByTestId("agent-avatar-glyph").textContent).toBe("M");
  });

  it("calls onDelete with the agent id when the danger button is clicked", () => {
    const onDelete = vi.fn();
    render(
      <AgentManager
        agents={AGENTS}
        personas={PERSONAS}
        agentId="refactor-bot"
        onCreate={NOOP_CREATE}
        onDelete={onDelete}
        onNavigateBack={NOOP}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-delete"));
    expect(onDelete).toHaveBeenCalledWith("refactor-bot");
  });
});
