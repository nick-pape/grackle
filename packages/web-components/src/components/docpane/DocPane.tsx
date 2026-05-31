import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type LazyExoticComponent,
} from "react";
import { X } from "lucide-react";
import type { DocumentTab, ResourceContentState } from "../../hooks/types.js";
import { useTheme } from "../../hooks/useTheme.js";
import { ICON_SM } from "../../utils/iconSize.js";
import { resolvePreviewKind } from "./PreviewRegistry.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { FallbackPreview } from "./FallbackPreview.js";
import type { CodePreviewProps } from "./CodePreview.js";
import styles from "./DocPane.module.scss";

// CodeMirror is heavy — lazy-load it so it stays in its own async chunk and only
// loads when a code/text file is actually viewed (#1396).
const CodePreview: LazyExoticComponent<ComponentType<CodePreviewProps>> = lazy(() =>
  import("./CodePreview.js").then((m) => ({ default: m.CodePreview })),
);

/** Default / min / max pane width (px) for the desktop resizable pane. */
const DEFAULT_WIDTH_PX: number = 480;
const MIN_WIDTH_PX: number = 320;
const MAX_WIDTH_PX: number = 960;
/** localStorage key persisting the user's chosen pane width. */
const WIDTH_STORAGE_KEY: string = "grackle.docpane.width";

/** Props for {@link DocPane}. */
export interface DocPaneProps {
  /** Open document tabs. */
  tabs: DocumentTab[];
  /** Active tab id, or undefined when empty. */
  activeTabId: string | undefined;
  /** Tab ids with an unseen change/open badge. */
  unseenTabIds: string[];
  /** Read cached content for a tab's environment + URI (undefined until first read). */
  getContent: (environmentId: string, uri: string) => ResourceContentState | undefined;
  /** Activate a tab. */
  onSelectTab: (tabId: string) => void;
  /** Close a tab. */
  onCloseTab: (tabId: string) => void;
  /** Open a `file://` URI (from a link inside a markdown doc) in the given environment. */
  onOpenUri?: (environmentId: string, uri: string) => void;
}

/** Read the persisted pane width, clamped, or the default. */
function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        return Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, parsed));
      }
    }
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return DEFAULT_WIDTH_PX;
}

/**
 * The live-docs side pane (#1396): a resizable right-hand pane with a tab per
 * open file, rendered read-only via the preview registry and live-refreshed by
 * the resource bridge. Presentational — all state + actions come from props
 * (wired from `useGrackle().documents` at the app layer). Renders nothing when
 * there are no open tabs.
 */
export function DocPane({
  tabs,
  activeTabId,
  unseenTabIds,
  getContent,
  onSelectTab,
  onCloseTab,
  onOpenUri,
}: DocPaneProps): JSX.Element | undefined {
  const { resolvedThemeId } = useTheme();
  const dark = resolvedThemeId.includes("dark") || resolvedThemeId === "matrix";

  const [width, setWidth] = useState<number>(readStoredWidth);
  const draggingRef = useRef<boolean>(false);

  // Track which tabs have ever had content, so a tab that loses its content
  // (file deleted → bridge drops the cache) shows "deleted" rather than "loading".
  const everLoadedRef = useRef<Set<string>>(new Set());

  // Pane resize: drag the left-edge handle. The pane lays out right-to-left, so
  // dragging left (smaller clientX) widens it.
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: PointerEvent): void => {
        if (!draggingRef.current) {
          return;
        }
        const next = Math.min(
          MAX_WIDTH_PX,
          Math.max(MIN_WIDTH_PX, startWidth + (startX - ev.clientX)),
        );
        setWidth(next);
      };
      const onUp = (): void => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // Width is persisted by the `useEffect([width])` below on every change;
        // no need to write here (and the closure's `width` is the pre-drag value).
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width],
  );

  // Persist width whenever it settles (covers the drag-end path above too).
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      // ignore
    }
  }, [width]);

  if (tabs.length === 0) {
    return undefined;
  }

  // tabs is non-empty here (early return above), so the index fallback is safe.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[tabs.length - 1];
  const content = getContent(activeTab.environmentId, activeTab.uri);
  if (content !== undefined) {
    everLoadedRef.current.add(activeTab.id);
  }

  function renderBody(): JSX.Element {
    if (content === undefined) {
      // Deleted if we previously had content for this tab; otherwise still loading.
      if (everLoadedRef.current.has(activeTab.id)) {
        return <FallbackPreview uri={activeTab.uri} deleted />;
      }
      return (
        <div className={styles.placeholder} data-testid="doc-loading">
          Loading…
        </div>
      );
    }
    const kind = resolvePreviewKind(content.encoding, content.contentType, activeTab.uri);
    if (kind === "markdown") {
      return (
        <MarkdownPreview
          content={content.data}
          onOpenUri={onOpenUri ? (uri) => onOpenUri(activeTab.environmentId, uri) : undefined}
        />
      );
    }
    if (kind === "code") {
      return (
        <Suspense fallback={<div className={styles.placeholder}>Loading…</div>}>
          <CodePreview content={content.data} uri={activeTab.uri} dark={dark} />
        </Suspense>
      );
    }
    return <FallbackPreview uri={activeTab.uri} />;
  }

  return (
    <aside
      className={styles.pane}
      style={{ width: `${width}px` }}
      data-testid="doc-pane"
      aria-label="Document viewer"
    >
      <div
        className={styles.resizeHandle}
        onPointerDown={onResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize document pane"
        data-testid="doc-pane-resize"
      />
      <div className={styles.tabStrip} role="tablist" data-testid="doc-tabstrip">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id;
          const unseen = unseenTabIds.includes(tab.id);
          return (
            <div
              key={tab.id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              data-testid="doc-tab"
              data-active={isActive}
              data-unseen={unseen}
            >
              <button
                type="button"
                className={styles.tabLabel}
                role="tab"
                aria-selected={isActive}
                title={tab.uri}
                onClick={() => onSelectTab(tab.id)}
              >
                {unseen && <span className={styles.unseenDot} aria-label="changed" />}
                {tab.title}
              </button>
              <button
                type="button"
                className={styles.tabClose}
                aria-label={`Close ${tab.title}`}
                title="Close"
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={ICON_SM} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <div className={styles.body}>{renderBody()}</div>
    </aside>
  );
}
