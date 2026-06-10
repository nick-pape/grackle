import { create } from "@bufbuild/protobuf";
import { grackle, NotFoundError, PreconditionError } from "@grackle-ai/common";
import { pluginStore } from "@grackle-ai/database";
import { emit } from "@grackle-ai/core";
import { getPluginRegistry, isPluginLoaded } from "./plugin-registry.js";

/** Build a PluginInfo message from registry metadata and DB state. */
function buildPluginInfo(name: string): grackle.PluginInfo {
  const entry = getPluginRegistry().find((p) => p.name === name);
  const row = pluginStore.getPlugin(name);

  // For required plugins (core), enabled is always true; no DB row needed
  const enabled = entry?.required ? true : (row?.enabled ?? entry?.defaultEnabled ?? true);

  return create(grackle.PluginInfoSchema, {
    name,
    description: entry?.description ?? "",
    enabled,
    required: entry?.required ?? false,
    loaded: isPluginLoaded(name),
  });
}

/** List all known plugins with their current state. */
export async function listPlugins(): Promise<grackle.PluginList> {
  const plugins = getPluginRegistry().map((entry) => buildPluginInfo(entry.name));
  return create(grackle.PluginListSchema, { plugins });
}

/** Enable or disable a plugin. Core (required) plugins cannot be disabled. */
export async function setPluginEnabled(
  req: grackle.SetPluginEnabledRequest,
): Promise<grackle.PluginInfo> {
  const entry = getPluginRegistry().find((p) => p.name === req.name);
  if (!entry) {
    throw new NotFoundError(`Plugin not found: ${req.name}`);
  }
  if (entry.required) {
    throw new PreconditionError(`Plugin "${req.name}" is required and cannot be disabled`);
  }

  pluginStore.setPluginEnabled(req.name, req.enabled);
  emit("plugin.changed", { name: req.name, enabled: req.enabled });

  return buildPluginInfo(req.name);
}
