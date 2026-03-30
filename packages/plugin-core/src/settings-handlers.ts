import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { DEFAULT_WEB_PORT } from "@grackle-ai/common";
import { settingsStore, personaStore, envRegistry, isAllowedSettingKey } from "@grackle-ai/database";
import { generatePairingCode as authGeneratePairingCode } from "@grackle-ai/auth";
import { checkVersionStatus } from "@grackle-ai/core";
import { detectLanIp } from "@grackle-ai/core";
import { emit } from "@grackle-ai/core";

/** Get the value of a setting by key. */
export async function getSetting(req: grackle.GetSettingRequest): Promise<grackle.SettingResponse> {
  if (!isAllowedSettingKey(req.key)) {
    throw new ConnectError(`Setting key not allowed: ${req.key}`, Code.InvalidArgument);
  }
  const value = settingsStore.getSetting(req.key);
  return create(grackle.SettingResponseSchema, {
    key: req.key,
    value: value ?? "",
  });
}

/** Set the value of a setting. */
export async function setSetting(req: grackle.SetSettingRequest): Promise<grackle.SettingResponse> {
  if (!isAllowedSettingKey(req.key)) {
    throw new ConnectError(`Setting key not allowed: ${req.key}`, Code.InvalidArgument);
  }
  // Validate persona exists and has required fields when setting default_persona_id
  if (req.key === "default_persona_id" && req.value) {
    const persona = personaStore.getPersona(req.value);
    if (!persona) {
      throw new ConnectError(`Persona not found: ${req.value}`, Code.NotFound);
    }
    if (!persona.runtime || !persona.model) {
      throw new ConnectError(
        `Persona "${persona.name}" must have runtime and model configured`,
        Code.FailedPrecondition,
      );
    }
  }
  settingsStore.setSetting(req.key, req.value);
  emit("setting.changed", { key: req.key, value: req.value });

  // Sync the local environment's defaultRuntime when the default persona changes,
  // so bootstrap pre-installs the correct runtime packages (fixes #1031).
  if (req.key === "default_persona_id" && req.value) {
    const newDefault = personaStore.getPersona(req.value);
    if (newDefault?.runtime) {
      const localEnv = envRegistry.getEnvironment("local");
      if (localEnv && localEnv.defaultRuntime !== newDefault.runtime) {
        envRegistry.updateDefaultRuntime("local", newDefault.runtime);
        emit("environment.changed", {});
      }
    }
  }

  return create(grackle.SettingResponseSchema, {
    key: req.key,
    value: req.value,
  });
}

/** Generate a new pairing code for web UI access. */
export async function generatePairingCode(): Promise<grackle.PairingCodeResponse> {
  const code = authGeneratePairingCode();
  if (!code) {
    throw new ConnectError(
      "Maximum active pairing codes reached. Wait for existing codes to expire.",
      Code.ResourceExhausted,
    );
  }

  const webPort = parseInt(process.env.GRACKLE_WEB_PORT || String(DEFAULT_WEB_PORT), 10);
  const bindHost = process.env.GRACKLE_HOST || "127.0.0.1";
  const WILDCARD_ADDRESSES: ReadonlySet<string> = new Set(["0.0.0.0", "::", "0:0:0:0:0:0:0:0"]);
  const pairingHost = WILDCARD_ADDRESSES.has(bindHost)
    ? (detectLanIp() || "localhost")
    : (bindHost === "127.0.0.1" || bindHost === "::1" ? "localhost" : bindHost);
  const url = `http://${pairingHost}:${webPort}/pair?code=${code}`;
  return create(grackle.PairingCodeResponseSchema, { code, url });
}

/** Get the current version status (update available, current/latest versions). */
export async function getVersionStatus(): Promise<grackle.VersionStatus> {
  const status = await checkVersionStatus();
  return create(grackle.VersionStatusSchema, {
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
    updateAvailable: status.updateAvailable,
    isDocker: status.isDocker,
  });
}
