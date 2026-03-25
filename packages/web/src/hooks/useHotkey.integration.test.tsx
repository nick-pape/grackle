// @vitest-environment jsdom
import { render, within, act, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { useState, type JSX } from "react";
import { useHotkey } from "./useHotkey.js";

afterEach(() => {
  cleanup();
  // Reset focus to body so stale activeElement doesn't suppress subsequent tests.
  (document.activeElement as HTMLElement | undefined)?.blur();
});

/** Dispatch a keyboard event on `document`. */
function pressKey(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

/** Get the aria-selected value of a tab by name. */
function isTabSelected(container: HTMLElement, name: string): boolean {
  const view = within(container);
  return view.getByRole("tab", { name }).getAttribute("aria-selected") === "true";
}

/** Test component that switches tabs via useHotkey, simulating TaskPage/WorkspacePage wiring. */
function TabSwitcher(): JSX.Element {
  const [tab, setTab] = useState<string>("overview");

  useHotkey({ key: "1" }, () => setTab("overview"));
  useHotkey({ key: "2" }, () => setTab("stream"));
  useHotkey({ key: "3" }, () => setTab("findings"));

  return (
    <div data-testid="tab-switcher">
      <button role="tab" aria-selected={tab === "overview"}>Overview</button>
      <button role="tab" aria-selected={tab === "stream"}>Stream</button>
      <button role="tab" aria-selected={tab === "findings"}>Findings</button>
    </div>
  );
}

/** Test component with global shortcuts, simulating GlobalShortcuts wiring. */
function NavigationShortcuts(): JSX.Element {
  const [lastAction, setLastAction] = useState<string>("none");

  useHotkey({ key: "?" }, () => setLastAction("shortcuts"));
  useHotkey({ key: "n" }, () => setLastAction("new-task"));

  return <div data-testid="last-action">{lastAction}</div>;
}

describe("useHotkey integration", () => {
  it("pressing 1/2/3 switches tabs (TaskPage/WorkspacePage pattern)", () => {
    const { container } = render(<TabSwitcher />);

    expect(isTabSelected(container, "Overview")).toBe(true);
    expect(isTabSelected(container, "Stream")).toBe(false);

    act(() => pressKey("2"));
    expect(isTabSelected(container, "Stream")).toBe(true);
    expect(isTabSelected(container, "Overview")).toBe(false);

    act(() => pressKey("3"));
    expect(isTabSelected(container, "Findings")).toBe(true);

    act(() => pressKey("1"));
    expect(isTabSelected(container, "Overview")).toBe(true);
  });

  it("tab shortcuts are suppressed when an input is focused", () => {
    const { container } = render(<TabSwitcher />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => pressKey("2"));
    expect(isTabSelected(container, "Overview")).toBe(true);

    document.body.removeChild(input);
  });

  it("global shortcuts trigger navigation actions (GlobalShortcuts pattern)", () => {
    const { getByTestId } = render(<NavigationShortcuts />);

    act(() => pressKey("?", { shiftKey: true }));
    expect(getByTestId("last-action").textContent).toBe("shortcuts");

    act(() => pressKey("n"));
    expect(getByTestId("last-action").textContent).toBe("new-task");
  });

  it("global shortcuts are suppressed when an input is focused", () => {
    const { getByTestId } = render(<NavigationShortcuts />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => pressKey("n"));
    expect(getByTestId("last-action").textContent).toBe("none");

    document.body.removeChild(input);
  });
});
