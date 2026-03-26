import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { claudeProviderModeToEnum, providerToggleToEnum } from "@grackle-ai/common";
import { tokenStore, credentialProviders } from "@grackle-ai/database";
import * as tokenPush from "./token-push.js";
import { emit } from "./event-bus.js";

/** Store or update a token. */
export async function setToken(req: grackle.TokenEntry): Promise<grackle.Empty> {
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  if (!req.value) {
    throw new ConnectError("value is required", Code.InvalidArgument);
  }
  tokenStore.setToken({
    name: req.name,
    type: req.type,
    envVar: req.envVar,
    filePath: req.filePath,
    value: req.value,
    expiresAt: req.expiresAt,
  });
  emit("token.changed", {});
  await tokenPush.pushToAll();
  return create(grackle.EmptySchema, {});
}

/** List all stored tokens (without values). */
export async function listTokens(): Promise<grackle.TokenList> {
  const items = tokenStore.listTokens();
  return create(grackle.TokenListSchema, {
    tokens: items.map((t) =>
      create(grackle.TokenInfoSchema, {
        name: t.name,
        type: t.type,
        envVar: t.envVar || "",
        filePath: t.filePath || "",
        expiresAt: t.expiresAt || "",
      }),
    ),
  });
}

/** Delete a token by name. */
export async function deleteToken(req: grackle.TokenName): Promise<grackle.Empty> {
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  tokenStore.deleteToken(req.name);
  emit("token.changed", {});
  await tokenPush.pushToAll();
  return create(grackle.EmptySchema, {});
}

/** Get the current credential provider configuration. */
export async function getCredentialProviders(): Promise<grackle.CredentialProviderConfig> {
  const config = credentialProviders.getCredentialProviders();
  return create(grackle.CredentialProviderConfigSchema, {
    claude: claudeProviderModeToEnum(config.claude),
    github: providerToggleToEnum(config.github),
    copilot: providerToggleToEnum(config.copilot),
    codex: providerToggleToEnum(config.codex),
    goose: providerToggleToEnum(config.goose),
  });
}

/** Set a specific credential provider value. */
export async function setCredentialProvider(req: grackle.SetCredentialProviderRequest): Promise<grackle.CredentialProviderConfig> {
  if (!credentialProviders.VALID_PROVIDERS.includes(req.provider)) {
    throw new ConnectError(
      `Invalid provider: ${req.provider}. Must be one of: ${credentialProviders.VALID_PROVIDERS.join(", ")}`,
      Code.InvalidArgument,
    );
  }

  const allowed = req.provider === "claude"
    ? credentialProviders.VALID_CLAUDE_VALUES
    : credentialProviders.VALID_TOGGLE_VALUES;

  if (!allowed.has(req.value)) {
    throw new ConnectError(
      `Invalid value for ${req.provider}: ${req.value}. Must be one of: ${[...allowed].join(", ")}`,
      Code.InvalidArgument,
    );
  }

  const current = credentialProviders.getCredentialProviders();
  const updated = { ...current, [req.provider]: req.value };
  credentialProviders.setCredentialProviders(updated);

  emit("credential.providers_changed", updated as unknown as Record<string, unknown>);

  return create(grackle.CredentialProviderConfigSchema, {
    claude: claudeProviderModeToEnum(updated.claude),
    github: providerToggleToEnum(updated.github),
    copilot: providerToggleToEnum(updated.copilot),
    codex: providerToggleToEnum(updated.codex),
    goose: providerToggleToEnum(updated.goose),
  });
}
