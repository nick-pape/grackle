import type { JSX } from "react";
import type { CredentialProviderConfig } from "../../hooks/types.js";
import styles from "./SettingsPanel.module.scss";

/** Provider descriptor for rendering toggle rows. */
interface ProviderDef {
  key: keyof CredentialProviderConfig;
  label: string;
  description: string;
  options: Array<{ value: string; label: string }>;
}

/** Definitions for each credential provider. */
const PROVIDERS: ProviderDef[] = [
  {
    key: "claude",
    label: "Claude",
    description: "Forward Claude credentials for AI agent access.",
    options: [
      { value: "off", label: "Off" },
      { value: "subscription", label: "Subscription" },
      { value: "api_key", label: "API Key" },
    ],
  },
  {
    key: "github",
    label: "GitHub",
    description: "Forward GITHUB_TOKEN and GH_TOKEN for git operations.",
    options: [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ],
  },
  {
    key: "copilot",
    label: "Copilot",
    description: "Forward Copilot tokens (COPILOT_GITHUB_TOKEN, CLI config).",
    options: [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ],
  },
  {
    key: "codex",
    label: "Codex",
    description: "Forward OPENAI_API_KEY for Codex/OpenAI access.",
    options: [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ],
  },
  {
    key: "goose",
    label: "Goose",
    description: "Forward Goose config and API keys for Goose agent access.",
    options: [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ],
  },
];

/** Props for the CredentialProvidersPanel component. */
interface CredentialProvidersPanelProps {
  /** Current credential provider configuration. */
  credentialProviders: CredentialProviderConfig;
  /** Callback to update the credential provider configuration. */
  onUpdateCredentialProviders: (config: CredentialProviderConfig) => void;
}

/** Panel for configuring which credential providers are auto-forwarded to environments. */
export function CredentialProvidersPanel({ credentialProviders, onUpdateCredentialProviders }: CredentialProvidersPanelProps): JSX.Element {

  const handleChange = (key: keyof CredentialProviderConfig, value: string): void => {
    const updated: CredentialProviderConfig = { ...credentialProviders };
    if (key === "claude") {
      updated.claude = value as CredentialProviderConfig["claude"];
    } else {
      updated[key] = value as "off" | "on";
    }
    onUpdateCredentialProviders(updated);
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Credential Providers</h3>
      <p className={styles.sectionDescription}>
        Enable providers to automatically forward credentials to environments at task start.
        Credentials are read fresh from the host each time.
      </p>

      <div className={styles.tokenList}>
        {PROVIDERS.map((provider) => (
          <div key={provider.key} className={styles.tokenRow}>
            <span className={styles.tokenName}>{provider.label}</span>
            <span className={styles.tokenTarget}>{provider.description}</span>
            <select
              className={styles.select}
              value={credentialProviders[provider.key]}
              onChange={(e) => handleChange(provider.key, e.target.value)}
            >
              {provider.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}
