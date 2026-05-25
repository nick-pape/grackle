import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, fuzzySearch, type FuzzyKey, BUILTIN_COMPONENTS } from "@grackle-ai/common";
import { componentStore, workspaceStore } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { componentRowToProto } from "./grpc-proto-converters.js";

/** Validate that a workspace id is present and refers to a real workspace. */
function requireWorkspace(workspaceId: string): void {
  if (!workspaceId) {
    throw new ConnectError("workspaceId is required", Code.InvalidArgument);
  }
  if (!workspaceStore.getWorkspace(workspaceId)) {
    throw new ConnectError(`Workspace not found: ${workspaceId}`, Code.NotFound);
  }
}

/** Wrap store validation errors (e.g. body-size cap) as INVALID_ARGUMENT. */
function asInvalidArgument(err: unknown): never {
  throw new ConnectError(err instanceof Error ? err.message : String(err), Code.InvalidArgument);
}

/** Register a new agent-authored component in the caller's workspace. */
export async function registerComponent(req: grackle.RegisterComponentRequest): Promise<grackle.Component> {
  requireWorkspace(req.workspaceId);
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  if (!req.body) {
    throw new ConnectError("body is required", Code.InvalidArgument);
  }
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
export async function updateComponent(req: grackle.UpdateComponentRequest): Promise<grackle.Component> {
  if (!req.id) {
    throw new ConnectError("id is required", Code.InvalidArgument);
  }
  const existing = componentStore.getComponent(req.id);
  // Workspace isolation: treat a component in another workspace as not found.
  if (!existing || (req.workspaceId && existing.workspaceId !== req.workspaceId)) {
    throw new ConnectError(`Component not found: ${req.id}`, Code.NotFound);
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
  return componentRowToProto(componentStore.getComponent(req.id)!);
}

/** Resolve a component by id (precedence) or by name within a workspace. */
export async function getComponent(req: grackle.GetComponentRequest): Promise<grackle.Component> {
  let row: componentStore.ComponentRow | undefined;
  if (req.id) {
    row = componentStore.getComponent(req.id);
    // Workspace isolation: hide components that belong to another workspace.
    if (row && req.workspaceId && row.workspaceId !== req.workspaceId) {
      row = undefined;
    }
  } else if (req.name) {
    if (!req.workspaceId) {
      throw new ConnectError("workspaceId is required to resolve a component by name", Code.InvalidArgument);
    }
    row = componentStore.findComponentByName(req.workspaceId, req.name);
  } else {
    throw new ConnectError("id or name is required", Code.InvalidArgument);
  }
  if (!row) {
    throw new ConnectError("Component not found", Code.NotFound);
  }
  return componentRowToProto(row);
}

/** List all components registered in a workspace. */
export async function listComponents(req: grackle.ListComponentsRequest): Promise<grackle.ComponentList> {
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
export async function searchComponents(req: grackle.SearchComponentsRequest): Promise<grackle.SearchComponentsResponse> {
  const query = req.query.trim();
  if (!query) {
    throw new ConnectError("query is required", Code.InvalidArgument);
  }
  const limit = req.limit > 0 ? req.limit : DEFAULT_COMPONENT_SEARCH_LIMIT;

  const items: SearchableComponent[] = [];
  if (req.workspaceId) {
    // Validate a supplied workspace (like listComponents) so a typo'd/unknown id
    // fails fast instead of silently returning only built-ins. An empty workspaceId
    // is allowed — it searches built-ins only.
    requireWorkspace(req.workspaceId);
    for (const row of componentStore.listComponents(req.workspaceId)) {
      items.push({ name: row.name, description: row.description, builtin: false, component: componentRowToProto(row) });
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
export async function setComponentPromotion(req: grackle.SetComponentPromotionRequest): Promise<grackle.Component> {
  requireWorkspace(req.workspaceId);
  let row: componentStore.ComponentRow | undefined;
  if (req.id) {
    row = componentStore.getComponent(req.id);
    // Workspace isolation: a component in another workspace is not found.
    if (row && row.workspaceId !== req.workspaceId) {
      row = undefined;
    }
  } else if (req.name) {
    row = componentStore.findComponentByName(req.workspaceId, req.name);
  } else {
    throw new ConnectError("id or name is required", Code.InvalidArgument);
  }
  if (!row) {
    throw new ConnectError("Component not found", Code.NotFound);
  }
  // `promoted` is optional on the wire so unset is distinguishable from false;
  // an unset value means "promote" (matches the component_promote tool default).
  componentStore.setPromoted(row.id, req.promoted ?? true);
  return componentRowToProto(componentStore.getComponent(row.id)!);
}
