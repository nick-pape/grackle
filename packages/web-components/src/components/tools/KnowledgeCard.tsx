import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { extractBareName } from "./classifyTool.js";
import { CopyButton } from "../display/CopyButton.js";
import styles from "./toolCards.module.scss";

/** Shape of a knowledge search result node. */
interface KnowledgeResult {
  score?: number;
  node?: KnowledgeNode;
}

/** Shape of a knowledge graph node. */
interface KnowledgeNode {
  id?: string;
  kind?: string;
  label?: string;
  title?: string;
  category?: string;
  content?: string;
  tags?: string[];
}

/** Extracts knowledge-relevant fields from tool args. */
function getArgs(args: unknown): { query?: string; id?: string } {
  if (args === null || args === undefined || typeof args !== "object") {
    return {};
  }
  const a = args as Record<string, unknown>;
  return {
    query: typeof a.query === "string" ? a.query : undefined,
    id: typeof a.id === "string" ? a.id : undefined,
  };
}

/** Parses knowledge result. Could be search results or a single node. */
function parseResult(result: string | undefined): { results?: KnowledgeResult[]; node?: KnowledgeNode; edgeCount?: number } {
  if (!result) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(result);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    // knowledge_search returns { results: [...], neighbors, neighborEdges }
    if (Array.isArray(obj.results)) {
      return { results: obj.results as KnowledgeResult[] };
    }
    // knowledge_get_node returns { node, edges, neighbors }
    if (typeof obj.node === "object" && obj.node !== null) {
      const edges = Array.isArray(obj.edges) ? obj.edges.length : 0;
      return { node: obj.node as KnowledgeNode, edgeCount: edges };
    }
    // knowledge_create_node returns { id, title, category }
    if (typeof obj.id === "string") {
      return { node: obj as KnowledgeNode };
    }
  } catch { /* fall through */ }
  return {};
}

/** Number of results shown when collapsed. */
const PREVIEW_COUNT: number = 5;

/** Renders a knowledge tool call (knowledge_search, knowledge_get_node) with structured display. */
export function KnowledgeCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const bareName = extractBareName(tool);
  const argData = getArgs(args);
  const inProgress = result === undefined;
  const resultData = parseResult(result);

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardPurple} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-knowledge"
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">&#x1F9E0;</span>
        <span className={styles.toolName} style={{ color: "var(--accent-purple, #a78bfa)" }}>
          {bareName}
        </span>
        {argData.query && (
          <span className={styles.fileName} data-testid="tool-card-knowledge-query">
            &quot;{argData.query}&quot;
          </span>
        )}
        {argData.id && !argData.query && (
          <span className={styles.fileName} data-testid="tool-card-knowledge-id">
            {argData.id}
          </span>
        )}
        {resultData.results && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-knowledge-count">
              {resultData.results.length} {resultData.results.length === 1 ? "result" : "results"}
            </span>
          </>
        )}
        {resultData.node && resultData.edgeCount !== undefined && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-knowledge-edges">
              {resultData.edgeCount} {resultData.edgeCount === 1 ? "edge" : "edges"}
            </span>
          </>
        )}
        {!inProgress && !isError && result && (
          <CopyButton text={result} data-testid="tool-card-copy" className={styles.copyButtonInline} />
        )}
      </div>

      {/* In-progress: show args */}
      {inProgress && args !== null && args !== undefined && !argData.query && !argData.id && (
        <pre className={styles.pre} data-testid="tool-card-args">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}

      {/* Error */}
      {isError && result && (
        <pre className={styles.pre} data-testid="tool-card-error">
          {result}
        </pre>
      )}

      {/* Search results */}
      {!isError && resultData.results && resultData.results.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-knowledge-results">
            {(expanded ? resultData.results : resultData.results.slice(0, PREVIEW_COUNT)).map((r) => {
              const label = r.node?.title ?? r.node?.label ?? r.node?.id ?? "node";
              const score = r.score !== undefined ? ` (${(r.score * 100).toFixed(0)}%)` : "";
              return `${label}${score}`;
            }).join("\n")}
          </pre>
          {resultData.results.length > PREVIEW_COUNT && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>&#x25B8;</span>
              {expanded ? "collapse" : `${resultData.results.length - PREVIEW_COUNT} more results`}
            </button>
          )}
        </>
      )}

      {/* Single node */}
      {!isError && resultData.node && !resultData.results && (
        <pre className={styles.pre} data-testid="tool-card-knowledge-node">
          {[
            resultData.node.id ? `id: ${resultData.node.id}` : null,
            resultData.node.title ? `title: ${resultData.node.title}` : null,
            resultData.node.category ? `category: ${resultData.node.category}` : null,
            resultData.node.kind ? `kind: ${resultData.node.kind}` : null,
            resultData.node.content ? `content: ${resultData.node.content.length > 100 ? resultData.node.content.slice(0, 100) + "..." : resultData.node.content}` : null,
          ].filter(Boolean).join("\n")}
        </pre>
      )}
    </div>
  );
}
