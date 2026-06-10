import { create } from "@bufbuild/protobuf";
import {
  grackle,
  fuzzySearch,
  type FuzzyKey,
  BUILTIN_COMPONENTS,
  extractComponentReferenceNames,
  NotFoundError,
  ValidationError,
} from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import type { ComponentRow } from "@grackle-ai/database";
import { emit } from "@grackle-ai/core";
import { v4 as uuid } from "uuid";
import { componentRowToProto } from "./grpc-proto-converters.js";
import { requireField, requireOneOf, requireTrimmed, requireWorkspace } from "./require-helpers.js";

/** Wrap store validation errors (e.g. body-size cap) as INVALID_ARGUMENT. */
function asInvalidArgument(err: unknown): never {
  throw new ValidationError(err instanceof Error ? err.message : String(err));
}

/** Register a new agent-authored component in the caller's workspace. */
export async function registerComponent(
  req: grackle.RegisterComponentRequest,
): Promise<grackle.Component> {
  const { componentStore } = getDatabaseStores();
  requireWorkspace(req.workspaceId);
  requireField(req.name, "name");
  requireField(req.body, "body");
  // Full UUID (not an 8-char slice): components are addressed by their agent-chosen
  // name in practice, so a long collision-proof id avoids a UNIQUE-constraint
  // throw being surfaced to the agent as a misleading INVALID_ARGUMENT.
  const id = uuid();
  try {
    componentStore.registerComponent({
      id,
      workspaceId: req.workspaceId,
      name: req.name,
      description: req.description,
      rendererKind: req.rendererKind || undefined,
      body: req.body,
      propsSchema: req.propsSchema,
      ownerTaskId: req.ownerTaskId,
      ownerSessionId: req.ownerSessionId,
    });
  } catch (err) {
    asInvalidArgument(err);
  }
  return componentRowToProto(componentStore.getComponent(id)!);
}

/** Update a component's mutable fields (only set fields change); bumps version. */
export async function updateComponent(
  req: grackle.UpdateComponentRequest,
): Promise<grackle.Component> {
  const { componentStore } = getDatabaseStores();
  requireField(req.id, "id");
  const existing = componentStore.getComponent(req.id);
  // Workspace isolation: treat a component in another workspace as not found.
  if (!existing || (req.workspaceId && existing.workspaceId !== req.workspaceId)) {
    throw new NotFoundError(`Component not found: ${req.id}`, { id: req.id });
  }
  try {
    componentStore.updateComponent(req.id, {
      name: req.name,
      description: req.description,
      body: req.body,
      propsSchema: req.propsSchema,
    });
  } catch (err) {
    asInvalidArgument(err);
  }
  const updated = componentStore.getComponent(req.id)!;
  // A promoted component's edit changes its render_<name> slug/description/inputSchema,
  // so nudge the workspace's MCP sessions to re-list (#1297). Non-promoted edits don't.
  if (updated.promoted) {
    emit("component.changed", { workspaceId: updated.workspaceId });
  }
  return componentRowToProto(updated);
}

/** Resolve a component by id (precedence) or by name within a workspace. */
export async function getComponent(req: grackle.GetComponentRequest): Promise<grackle.Component> {
  const { componentStore } = getDatabaseStores();
  let row: ComponentRow | undefined;
  if (req.id) {
    row = componentStore.getComponent(req.id);
    // Workspace isolation: hide components that belong to another workspace.
    if (row && req.workspaceId && row.workspaceId !== req.workspaceId) {
      row = undefined;
    }
  } else if (req.name) {
    if (!req.workspaceId) {
      throw new ValidationError("workspaceId is required to resolve a component by name");
    }
    row = componentStore.findComponentByName(req.workspaceId, req.name);
  } else {
    requireOneOf({ id: req.id, name: req.name });
  }
  if (!row) {
    throw new NotFoundError("Component not found", {
      id: req.id,
      name: req.name,
      workspaceId: req.workspaceId,
    });
  }
  return componentRowToProto(row);
}

/** List all components registered in a workspace. */
export async function listComponents(
  req: grackle.ListComponentsRequest,
): Promise<grackle.ComponentList> {
  const { componentStore } = getDatabaseStores();
  requireWorkspace(req.workspaceId);
  return create(grackle.ComponentListSchema, {
    components: componentStore.listComponents(req.workspaceId).map(componentRowToProto),
  });
}

/** Weighted fuzzy-search fields: a component's name matters more than its description. */
const COMPONENT_SEARCH_KEYS: FuzzyKey[] = [
  { name: "name", weight: 2 },
  { name: "description", weight: 1 },
];

/** Default max results when the request leaves `limit` unset. */
const DEFAULT_COMPONENT_SEARCH_LIMIT = 10;

/**
 * Sentinel id prefix for built-in components in search results. Built-ins are not
 * DB rows (no real id), so we stamp a stable, clearly non-routable id like
 * `builtin:Button` to keep the `Component` shape self-describing — a `getComponent`
 * call with such an id cleanly resolves to NotFound rather than acting on an empty id.
 */
const BUILTIN_COMPONENT_ID_PREFIX = "builtin:";

/** A unit fed to the fuzzy matcher: a workspace component or a built-in, with its proto form. */
interface SearchableComponent {
  name: string;
  description: string;
  builtin: boolean;
  component: grackle.Component;
}

/**
 * Keyword-search the component registry: the caller's workspace-authored
 * components plus the always-available Grackle built-ins, ranked by relevance.
 * Built-in results carry `builtin: true` (they are composed in JSX, not rendered
 * by reference).
 */
export async function searchComponents(
  req: grackle.SearchComponentsRequest,
): Promise<grackle.SearchComponentsResponse> {
  const { componentStore } = getDatabaseStores();
  const query = requireTrimmed(req.query, "query");
  const limit = req.limit > 0 ? req.limit : DEFAULT_COMPONENT_SEARCH_LIMIT;

  const items: SearchableComponent[] = [];
  if (req.workspaceId) {
    // Validate a supplied workspace (like listComponents) so a typo'd/unknown id
    // fails fast instead of silently returning only built-ins. An empty workspaceId
    // is allowed — it searches built-ins only.
    requireWorkspace(req.workspaceId);
    for (const row of componentStore.listComponents(req.workspaceId)) {
      items.push({
        name: row.name,
        description: row.description,
        builtin: false,
        component: componentRowToProto(row),
      });
    }
  }
  for (const b of BUILTIN_COMPONENTS) {
    items.push({
      name: b.name,
      description: b.description,
      builtin: true,
      component: create(grackle.ComponentSchema, {
        id: `${BUILTIN_COMPONENT_ID_PREFIX}${b.name}`,
        name: b.name,
        description: b.description,
        rendererKind: "grackle-react",
        propsSchema: b.propsSchema,
      }),
    });
  }

  const results = fuzzySearch(items, query, COMPONENT_SEARCH_KEYS, { limit });
  return create(grackle.SearchComponentsResponseSchema, {
    results: results.map((r) =>
      create(grackle.SearchComponentResultSchema, {
        component: r.item.component,
        relevanceScore: 1 - r.score,
        builtin: r.item.builtin,
      }),
    ),
  });
}

/**
 * Promote (or demote) a component, controlling whether it surfaces as a dynamic
 * `render_<name>` MCP tool (#1272). Resolves by id (precedence) or by name within
 * the caller's workspace; the workspace-ownership check (a component in another
 * workspace is treated as not found) is the authorization boundary for the
 * dynamic tool. Promotion does not bump the component's version.
 */
export async function setComponentPromotion(
  req: grackle.SetComponentPromotionRequest,
): Promise<grackle.Component> {
  const { componentStore } = getDatabaseStores();
  requireWorkspace(req.workspaceId);
  let row: ComponentRow | undefined;
  if (req.id) {
    row = componentStore.getComponent(req.id);
    // Workspace isolation: a component in another workspace is not found.
    if (row && row.workspaceId !== req.workspaceId) {
      row = undefined;
    }
  } else if (req.name) {
    row = componentStore.findComponentByName(req.workspaceId, req.name);
  } else {
    requireOneOf({ id: req.id, name: req.name });
  }
  if (!row) {
    throw new NotFoundError("Component not found", {
      id: req.id,
      name: req.name,
      workspaceId: req.workspaceId,
    });
  }
  // `promoted` is optional on the wire so unset is distinguishable from false;
  // an unset value means "promote" (matches the component_promote tool default).
  componentStore.setPromoted(row.id, req.promoted ?? true);
  // Promote/demote changes the workspace's dynamic render_<name> tool set; nudge
  // its live MCP sessions to re-list via tools/list_changed (#1297).
  emit("component.changed", { workspaceId: row.workspaceId });
  return componentRowToProto(componentStore.getComponent(row.id)!);
}

/** Renderer kind eligible for composition (raw HTML can't compose into a React scope). */
const COMPOSABLE_RENDERER_KIND: string = "grackle-react";
/** Caps bounding the composition graph walk against pathological/huge graphs (#1270). */
const MAX_COMPOSITION_DEPTH: number = 32;
const MAX_COMPOSITION_COMPONENTS: number = 64;
const MAX_COMPOSITION_BYTES: number = 256 * 1024;
/** Built-in component names are always in the runtime scope — never resolved as registry refs. */
const BUILTIN_COMPONENT_NAMES: ReadonlySet<string> = new Set(BUILTIN_COMPONENTS.map((c) => c.name));

/**
 * Resolve a component's transitive registry references for composition (#1270).
 * Scans the root body (a registry component by id/name, or a raw `source`) for
 * capitalized JSX tags, resolves each to a workspace component (excluding
 * built-ins), and recurses — a mini-bundler over the registry graph. Late-bound:
 * references resolve to each component's CURRENT version. Returns dependencies in
 * post-order (deepest first) so the runtime evals them into scope in array order.
 *
 * Cycle-safe: a `visited` set (by id) resolves each component once, so a cyclic
 * reference terminates the walk. Caps bound depth, count, and total bytes; only
 * `grackle-react` components compose (raw-HTML references are skipped).
 */
export async function resolveComponentGraph(
  req: grackle.ResolveComponentGraphRequest,
): Promise<grackle.ResolveComponentGraphResponse> {
  const { componentStore } = getDatabaseStores();
  requireWorkspace(req.workspaceId);

  let root: ComponentRow | undefined;
  let rootBody: string;
  if (req.source) {
    rootBody = req.source;
  } else if (req.id || req.name) {
    root = req.id
      ? componentStore.getComponent(req.id)
      : componentStore.findComponentByName(req.workspaceId, req.name);
    if (root && root.workspaceId !== req.workspaceId) {
      root = undefined; // workspace isolation
    }
    if (!root) {
      throw new NotFoundError("Component not found", {
        id: req.id,
        name: req.name,
        workspaceId: req.workspaceId,
      });
    }
    rootBody = root.body;
  } else {
    requireOneOf({ source: req.source, id: req.id, name: req.name });
    rootBody = ""; // unreachable — requireOneOf throws
  }

  const ordered: ComponentRow[] = [];
  const visited = new Set<string>(); // component ids already resolved (cycle-safe + dedupe)
  let totalBytes = 0;

  const walk = (body: string, depth: number): void => {
    if (depth > MAX_COMPOSITION_DEPTH || ordered.length >= MAX_COMPOSITION_COMPONENTS) {
      return;
    }
    for (const name of extractComponentReferenceNames(body)) {
      // Stop scanning once the cap is hit — avoids further findComponentByName lookups.
      if (ordered.length >= MAX_COMPOSITION_COMPONENTS || totalBytes >= MAX_COMPOSITION_BYTES) {
        break;
      }
      if (BUILTIN_COMPONENT_NAMES.has(name)) {
        continue; // built-ins are already in the runtime scope
      }
      const dep = componentStore.findComponentByName(req.workspaceId, name);
      if (!dep || visited.has(dep.id) || dep.rendererKind !== COMPOSABLE_RENDERER_KIND) {
        continue;
      }
      visited.add(dep.id);
      walk(dep.body, depth + 1); // recurse first → post-order (deepest dependency first)
      if (
        ordered.length >= MAX_COMPOSITION_COMPONENTS ||
        totalBytes + dep.body.length > MAX_COMPOSITION_BYTES
      ) {
        continue;
      }
      totalBytes += dep.body.length;
      ordered.push(dep);
    }
  };

  if (root) {
    visited.add(root.id); // a root referencing itself is not a dependency
  }
  walk(rootBody, 0);

  return create(grackle.ResolveComponentGraphResponseSchema, {
    root: root ? componentRowToProto(root) : undefined,
    dependencies: ordered.map(componentRowToProto),
  });
}
