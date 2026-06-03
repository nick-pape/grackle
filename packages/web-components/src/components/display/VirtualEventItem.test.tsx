// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualEventItem, type VirtualEventItemProps } from "./VirtualEventItem.js";
import { makeEvent } from "../../test-utils/storybook-helpers.js";
import type { DisplayEvent } from "../../utils/sessionEvents.js";

function makeDisplayEvent(overrides: Partial<DisplayEvent> = {}): DisplayEvent {
  return { ...makeEvent(overrides), ...overrides };
}

function makeProps(overrides: Partial<VirtualEventItemProps> = {}): VirtualEventItemProps {
  return {
    event: makeDisplayEvent({ eventType: "text", content: "Hello world" }),
    originalIndex: 0,
    isSelecting: false,
    isSelected: false,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onCopied: vi.fn(),
    isNew: false,
    isReversed: false,
    ...overrides,
  };
}

describe("VirtualEventItem", () => {
  it("renders the event content via EventRenderer", () => {
    render(<VirtualEventItem {...makeProps()} />);
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("applies eventFadeIn class when isNew is true", () => {
    const { container } = render(<VirtualEventItem {...makeProps({ isNew: true })} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("eventFadeIn");
    expect(wrapper.className).not.toContain("Reversed");
  });

  it("applies eventFadeInReversed class when isNew and isReversed", () => {
    const { container } = render(
      <VirtualEventItem {...makeProps({ isNew: true, isReversed: true })} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("eventFadeInReversed");
  });

  it("does not apply animation class when isNew is false", () => {
    const { container } = render(<VirtualEventItem {...makeProps({ isNew: false })} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain("eventFadeIn");
  });

  it("renders hover row with copy and select in normal mode", () => {
    render(<VirtualEventItem {...makeProps()} />);
    expect(screen.getAllByTestId("event-hover-row").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("event-hover-copy").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("event-hover-select").length).toBeGreaterThan(0);
  });

  it("renders checkboxes in selection mode", () => {
    render(<VirtualEventItem {...makeProps({ isSelecting: true })} />);
    expect(screen.getAllByTestId("event-select-checkbox").length).toBeGreaterThan(0);
  });
});
