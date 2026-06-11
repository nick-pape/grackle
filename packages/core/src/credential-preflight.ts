/**
 * Pure pre-flight credential validation — cross-checks advertised needs
 * against a materialized bundle and formats actionable error messages.
 *
 * No side effects: derives results from the supplied needs + bundle + clock.
 */
import type { ProviderTokenBundle } from "./credential-types.js";
import type { ProtectedResourceDescriptor } from "./credential-needs.js";
import { inspectFileCredentialExpiry } from "./credential-inspector.js";

/** A credential need that the materialized bundle does not satisfy, with the reason. */
export interface UnsatisfiedNeed {
  /** The advertised need that is not met. */
  need: ProtectedResourceDescriptor;
  /** Why the need is unmet: no credential at all, or an expired non-refreshable one. */
  reason: "missing" | "expired";
}

/**
 * Cross-check a runtime's advertised {@link ProtectedResourceDescriptor needs}
 * against the credentials a {@link buildProviderTokenBundle} actually materialized,
 * returning the needs that are not satisfied. A need is unsatisfied when:
 *
 * - **missing** — the bundle contains no token tagged for the need's provider, or
 * - **expired** — the provider materialized credential(s) but **every** one is an
 *   expired OAuth file with no refresh token (re-login required).
 *
 * A token counts as usable unless it is `expired-unrecoverable` — a refreshable
 * expiry (the runtime refreshes on launch) and an `unknown`-expiry token (e.g. an
 * API key, whose expiry is not offline-knowable) both satisfy the need. So when a
 * provider emits more than one credential (e.g. Codex emits both `~/.codex/auth.json`
 * *and* `OPENAI_API_KEY`), a stale OAuth file does not fail the spawn as long as a
 * working fallback is present.
 *
 * Pure: derives entirely from `needs` + `bundle` + `now`, reads nothing.
 */
export function findUnsatisfiedNeeds(
  needs: ProtectedResourceDescriptor[],
  bundle: ProviderTokenBundle,
  now: number,
): UnsatisfiedNeed[] {
  const unsatisfied: UnsatisfiedNeed[] = [];
  for (const need of needs) {
    const tokens = bundle.tokens.filter((t) => t.provider === need.provider);
    if (tokens.length === 0) {
      unsatisfied.push({ need, reason: "missing" });
      continue;
    }
    // Report expired only when there is no usable credential — i.e. every token
    // for the provider is an expired, non-refreshable OAuth file.
    if (tokens.every((t) => inspectFileCredentialExpiry(t, now) === "expired-unrecoverable")) {
      unsatisfied.push({ need, reason: "expired" });
    }
  }
  return unsatisfied;
}

/**
 * Build a human-readable, actionable pre-flight error message for credentials
 * that are required but missing or expired — surfaced to the CLI and web before
 * a spawn instead of as an opaque 401 deep inside the runtime.
 */
export function formatPreflightCredentialError(
  runtime: string,
  unsatisfied: UnsatisfiedNeed[],
): string {
  const lines = unsatisfied.map(({ need, reason }) => {
    const subject = `${need.resourceName} (provider "${need.provider}")`;
    return reason === "missing"
      ? `  • ${subject}: enabled but no credential was found`
      : `  • ${subject}: login expired and cannot be refreshed — re-login required`;
  });
  return (
    `Cannot start runtime "${runtime}": required credential(s) unavailable.\n` +
    `${lines.join("\n")}\n` +
    `Configure or disable the provider with \`grackle credential-provider set <provider> <value>\`, then retry.`
  );
}

/** Per-provider actionable hints for the "provider is off" error message. */
const PROVIDER_SETUP_HINTS: Partial<Record<string, string>> = {
  claude:
    "Set ANTHROPIC_API_KEY (api_key mode) or configure a Claude subscription (subscription mode):\n" +
    "  grackle credential-provider set claude api_key",
  copilot:
    "Set COPILOT_GITHUB_TOKEN or mount ~/.copilot/config.json (via -v), then:\n" +
    "  grackle credential-provider set copilot on",
  codex:
    "Set OPENAI_API_KEY or mount ~/.codex/auth.json (via -v), then:\n" +
    "  grackle credential-provider set codex on",
  goose: "Configure Goose credentials, then:\n  grackle credential-provider set goose on",
  github: "Set GH_TOKEN or GITHUB_TOKEN, then:\n  grackle credential-provider set github on",
};

/**
 * Build an actionable error message for the case where a runtime's required
 * credential provider is disabled (`"off"`) — a misconfiguration not caught by
 * {@link formatPreflightCredentialError} because disabled providers produce no
 * needs to validate.
 */
export function formatRuntimeProviderDisabledError(runtime: string, provider: string): string {
  const hint = PROVIDER_SETUP_HINTS[provider];
  return (
    `Cannot start runtime "${runtime}": the required "${provider}" credential provider is not configured.\n` +
    (hint ? `${hint}\n` : `  grackle credential-provider set ${provider} on\n`) +
    `Or choose a different runtime with \`grackle persona edit <persona-id> --runtime <runtime>\`.`
  );
}
