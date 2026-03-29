import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type JSX, type ReactElement } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.scss";

/** Placement direction for the tooltip relative to its trigger. */
export type TooltipPlacement = "top" | "bottom" | "left" | "right";

/** Props for the {@link Tooltip} component. */
export interface TooltipProps {
  /** Text content to display in the tooltip. */
  text: string;
  /** Placement relative to the trigger element. Defaults to `"top"`. */
  placement?: TooltipPlacement;
  /** Delay in milliseconds before showing. Defaults to `300`. */
  delayMs?: number;
  /** Whether the wrapper is inline (`span`) or block (`div`). Defaults to `true`. */
  inline?: boolean;
  /** The trigger element to wrap. */
  children: React.ReactNode;
  /** Additional CSS class for the wrapper element. */
  className?: string;
  /** Test ID for the tooltip content element. */
  "data-testid"?: string;
}

/** Default delay in milliseconds before the tooltip appears. */
const DEFAULT_DELAY_MS: number = 300;

/** Gap in pixels between the tooltip and the trigger element. */
const TOOLTIP_GAP_PX: number = 6;

/**
 * Lightweight tooltip wrapper that shows text on hover or keyboard focus.
 *
 * Wraps a single child element with a hover/focus-triggered tooltip.
 * Renders the tooltip bubble via a portal to `document.body` so it escapes
 * all stacking contexts, `overflow: hidden`, and `backdrop-filter` traps.
 */
export function Tooltip({
  text,
  placement = "top",
  delayMs = DEFAULT_DELAY_MS,
  inline = true,
  children,
  className,
  "data-testid": testId,
}: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tooltipId = useId();

  const canPortal = typeof document !== "undefined";

  const computePosition = useCallback((): void => {
    if (!wrapperRef.current || !tooltipRef.current) {
      return;
    }
    const rect = wrapperRef.current.getBoundingClientRect();
    const tipRect = tooltipRef.current.getBoundingClientRect();
    let top = 0;
    let left = 0;
    switch (placement) {
      case "top":
        top = rect.top - tipRect.height - TOOLTIP_GAP_PX;
        left = rect.left + rect.width / 2 - tipRect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + TOOLTIP_GAP_PX;
        left = rect.left + rect.width / 2 - tipRect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2 - tipRect.height / 2;
        left = rect.left - tipRect.width - TOOLTIP_GAP_PX;
        break;
      case "right":
        top = rect.top + rect.height / 2 - tipRect.height / 2;
        left = rect.right + TOOLTIP_GAP_PX;
        break;
    }
    setCoords({ top, left });
  }, [placement]);

  const show = useCallback((): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      computePosition();
      setVisible(true);
      timerRef.current = undefined;
    }, delayMs);
  }, [delayMs, computePosition]);

  const hide = useCallback((): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setVisible(false);
  }, []);

  // Dismiss on Escape key; reposition on scroll/resize while visible.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        hide();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", computePosition, true);
    window.addEventListener("resize", computePosition);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", computePosition, true);
      window.removeEventListener("resize", computePosition);
    };
  }, [visible, hide, computePosition]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const Tag = inline ? "span" : "div";
  const wrapperClass = [
    inline ? styles.wrapper : styles.wrapperBlock,
    className,
  ].filter(Boolean).join(" ");

  // Inject aria-describedby onto the child element when it is a single
  // ReactElement so screen readers announce the tooltip from the focused node.
  const describedBy = visible ? tooltipId : undefined;
  let renderedChildren: React.ReactNode = children;
  if (isValidElement(children)) {
    renderedChildren = cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
      "aria-describedby": describedBy,
    });
  }

  const tooltipElement = (
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      className={`${styles.tooltip} ${styles[placement]} ${visible ? styles.visible : ""}`}
      style={{ top: coords.top, left: coords.left }}
      data-testid={testId ?? "tooltip"}
    >
      {text}
    </div>
  );

  return (
    <Tag
      ref={wrapperRef as React.Ref<HTMLSpanElement & HTMLDivElement>}
      className={wrapperClass}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {renderedChildren}
      {canPortal ? createPortal(tooltipElement, document.body) : null}
    </Tag>
  );
}
