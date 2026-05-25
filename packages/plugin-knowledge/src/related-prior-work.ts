/**
 * Spawn-time "Related prior work" retrieval (#1259) — the thin PUSH half of the
 * knowledge retrieval loop.
 *
 * At session spawn the knowledge plugin contributes a small system-prompt
 * section: it searches the graph with the task's title+description, expands one
 * hop from the top hit, excludes the task's own node, scopes to the workspace,
 * applies a conservative min-score floor + char budget, and formats a
 * "## Related prior work" block. Returns `undefined` when knowledge is
 * unavailable, the task opted out, or nothing relevant is found.
 *
 * @module
 */

import {
  knowledgeSearch,
  expandNode,
  findReferenceNodeBySource,
  REFERENCE_SOURCE,
  type KnowledgeNode,
  type SearchResult,
} from "@grackle-ai/knowledge";
import type { SpawnContextInput } from "@grackle-ai/plugin-sdk";
import { getKnowledgeEmbedder } from "./knowledge-init.js";
import { isNeo4jHealthy } from "./knowledge-health.js";
import { deriveTaskTextFromParts } from "./projection/derive-text.js";

/** Tunable retrieval/formatting config, resolved per call so env overrides apply live. */
interface RelatedWorkConfig {
  minScore: number;
  limit: number;
  maxItems: number;
  maxChars: number;
  perItemChars: number;
  expand: boolean;
  expandTopK: number;
  expandDepth: number;
}

/** Read a non-negative numeric env override, falling back to the default. */
function envNum(name: string, fallback: number): number {
  const value: number = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Read a boolean env override ("1"/"true" = true), falling back to the default. */
function envBool(name: string, fallback: boolean): boolean {
  const value: string | undefined = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

/** Resolve the conservative defaults, each overridable via `GRACKLE_KG_RELATED_*`. */
function resolveConfig(): RelatedWorkConfig {
  return {
    // Conservative floor: prefer no block over marginal matches (esp. on a sparse graph).
    minScore: envNum("GRACKLE_KG_RELATED_MIN_SCORE", 0.35),
    limit: envNum("GRACKLE_KG_RELATED_LIMIT", 5),
    maxItems: envNum("GRACKLE_KG_RELATED_MAX_ITEMS", 6),
    maxChars: envNum("GRACKLE_KG_RELATED_MAX_CHARS", 2000),
    perItemChars: envNum("GRACKLE_KG_RELATED_PER_ITEM_CHARS", 300),
    expand: envBool("GRACKLE_KG_RELATED_EXPAND", true),
    expandTopK: envNum("GRACKLE_KG_RELATED_EXPAND_TOPK", 1),
    expandDepth: envNum("GRACKLE_KG_RELATED_EXPAND_DEPTH", 1),
  };
}

/** An item to render: a node plus its similarity score (0 = a 1-hop neighbor, no score). */
interface RelatedItem {
  node: KnowledgeNode;
  score: number;
}

/**
 * Build the "Related prior work" system-prompt section for a spawning task, or
 * `undefined` when there is nothing relevant / knowledge is unavailable.
 */
export async function buildRelatedPriorWork(input: SpawnContextInput): Promise<string | undefined> {
  // Gates: per-task opt-out, missing data, workspace scope (global "" excluded), availability.
  if (!input.injectKnowledge || !input.title || !input.workspaceId) {
    return undefined;
  }
  if (!isNeo4jHealthy()) {
    return undefined;
  }
  const embedder = getKnowledgeEmbedder();
  if (!embedder) {
    return undefined;
  }

  const config: RelatedWorkConfig = resolveConfig();

  // Query embeds the same way the task's node was embedded (symmetry → meaningful similarity).
  const query: string = deriveTaskTextFromParts(input.title, input.description);
  const results: SearchResult[] = await knowledgeSearch(query, embedder, {
    workspaceId: input.workspaceId,
    minScore: config.minScore,
    limit: config.limit,
  });
  if (results.length === 0) {
    return undefined;
  }

  // Self-exclusion, two layers: by resolved node id, AND defensively by sourceId
  // (covers the race where the task's own node is not projected yet at spawn).
  const selfNode = await findReferenceNodeBySource(REFERENCE_SOURCE.TASK, input.taskId).catch(() => undefined);
  const selfNodeId: string | undefined = selfNode?.id;
  const isSelf = (node: KnowledgeNode): boolean =>
    node.id === selfNodeId || (node.kind === "reference" && node.sourceId === input.taskId);

  const ranked: SearchResult[] = [...results].sort((a, b) => b.score - a.score).filter((r) => !isSelf(r.node));
  const items: RelatedItem[] = ranked.map((r) => ({ node: r.node, score: r.score }));
  const seen: Set<string> = new Set(items.map((item) => item.node.id));

  // Optional 1-hop expansion from the top hit(s) to surface connected prior work.
  if (config.expand && ranked.length > 0) {
    for (const top of ranked.slice(0, config.expandTopK)) {
      const expansion = await expandNode(top.node.id, { depth: config.expandDepth }).catch(
        () => ({ nodes: [] as KnowledgeNode[], edges: [] }),
      );
      for (const neighbor of expansion.nodes) {
        const inScope: boolean = neighbor.workspaceId === input.workspaceId || neighbor.workspaceId === "";
        if (!seen.has(neighbor.id) && !isSelf(neighbor) && inScope) {
          seen.add(neighbor.id);
          items.push({ node: neighbor, score: 0 });
        }
      }
    }
  }

  if (items.length === 0) {
    return undefined;
  }

  return formatSection(items, config) || undefined;
}

/** One-line snippet from a node's content, collapsed + length-capped. */
function snippet(text: string, maxChars: number): string {
  const collapsed: string = text.replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed;
}

/** Render one item as a markdown bullet. */
function formatItem(item: RelatedItem, perItemChars: number): string {
  const { node, score } = item;
  const sim: string = score > 0 ? ` (similarity ${score.toFixed(2)})` : "";
  if (node.kind === "reference") {
    // Transcript chunks carry content; tasks/sessions/etc. carry a label.
    if (node.content) {
      return `- ${node.label || node.sourceType}: ${snippet(node.content, perItemChars)}${sim}`;
    }
    return `- [${node.sourceType}] ${node.label}${sim}`;
  }
  return `- ${node.title}: ${snippet(node.content, perItemChars)}${sim}`;
}

/** Assemble the budgeted markdown block (accumulate-then-stop; never slices mid-line). */
function formatSection(items: RelatedItem[], config: RelatedWorkConfig): string {
  const header = "## Related prior work";
  const intro = "Relevant earlier work in this workspace (from the knowledge graph). Use `knowledge_search` to dig deeper before starting.";
  const lines: string[] = [header, intro];
  let total: number = header.length + intro.length + 2;

  let count: number = 0;
  for (const item of items) {
    if (count >= config.maxItems) {
      break;
    }
    const line: string = formatItem(item, config.perItemChars);
    if (total + line.length + 1 > config.maxChars) {
      break;
    }
    lines.push(line);
    total += line.length + 1;
    count += 1;
  }

  // Only intro + header, no items fit → contribute nothing.
  return count > 0 ? lines.join("\n") : "";
}
