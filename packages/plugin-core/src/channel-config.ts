/**
 * Runtime configuration for channel-capability handlers.
 *
 * Channel handlers are stateless module functions, but minting tokens and
 * building ingress URLs requires the signing secret and the public web base
 * URL — known only at server startup. The composition root calls
 * {@link setChannelConfig} once; handlers read it via {@link getChannelConfig}.
 *
 * @module
 */

/** Configuration required by channel-capability handlers. */
export interface ChannelConfig {
  /** HMAC signing secret for channel tokens (the server API key). */
  signingSecret: string;
  /** Public base URL for ingress webhook URLs, e.g. `http://127.0.0.1:3000`. */
  ingressBaseUrl: string;
}

let config: ChannelConfig | undefined;

/** Configure channel handlers. Called once at server startup. */
export function setChannelConfig(next: ChannelConfig): void {
  config = next;
}

/** Get the channel config, throwing if {@link setChannelConfig} was not called. */
export function getChannelConfig(): ChannelConfig {
  if (!config) {
    throw new Error("Channel handlers not configured: call setChannelConfig() at startup");
  }
  return config;
}
