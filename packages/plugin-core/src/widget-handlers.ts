import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { widgetStore, workspaceStore } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { widgetRowToProto } from "./grpc-proto-converters.js";

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

/** Register a new agent-authored widget in the caller's workspace. */
export async function registerWidget(req: grackle.RegisterWidgetRequest): Promise<grackle.Widget> {
  requireWorkspace(req.workspaceId);
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  if (!req.body) {
    throw new ConnectError("body is required", Code.InvalidArgument);
  }
  const id = uuid().slice(0, 8);
  try {
    widgetStore.registerWidget({
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
  return widgetRowToProto(widgetStore.getWidget(id)!);
}

/** Update a widget's mutable fields (only set fields change); bumps version. */
export async function updateWidget(req: grackle.UpdateWidgetRequest): Promise<grackle.Widget> {
  if (!req.id) {
    throw new ConnectError("id is required", Code.InvalidArgument);
  }
  const existing = widgetStore.getWidget(req.id);
  // Workspace isolation: treat a widget in another workspace as not found.
  if (!existing || (req.workspaceId && existing.workspaceId !== req.workspaceId)) {
    throw new ConnectError(`Widget not found: ${req.id}`, Code.NotFound);
  }
  try {
    widgetStore.updateWidget(req.id, {
      name: req.name,
      description: req.description,
      body: req.body,
      propsSchema: req.propsSchema,
    });
  } catch (err) {
    asInvalidArgument(err);
  }
  return widgetRowToProto(widgetStore.getWidget(req.id)!);
}

/** Resolve a widget by id (precedence) or by name within a workspace. */
export async function getWidget(req: grackle.GetWidgetRequest): Promise<grackle.Widget> {
  let row: widgetStore.WidgetRow | undefined;
  if (req.id) {
    row = widgetStore.getWidget(req.id);
    // Workspace isolation: hide widgets that belong to another workspace.
    if (row && req.workspaceId && row.workspaceId !== req.workspaceId) {
      row = undefined;
    }
  } else if (req.name) {
    if (!req.workspaceId) {
      throw new ConnectError("workspaceId is required to resolve a widget by name", Code.InvalidArgument);
    }
    row = widgetStore.findWidgetByName(req.workspaceId, req.name);
  } else {
    throw new ConnectError("id or name is required", Code.InvalidArgument);
  }
  if (!row) {
    throw new ConnectError("Widget not found", Code.NotFound);
  }
  return widgetRowToProto(row);
}

/** List all widgets registered in a workspace. */
export async function listWidgets(req: grackle.ListWidgetsRequest): Promise<grackle.WidgetList> {
  requireWorkspace(req.workspaceId);
  return create(grackle.WidgetListSchema, {
    widgets: widgetStore.listWidgets(req.workspaceId).map(widgetRowToProto),
  });
}
