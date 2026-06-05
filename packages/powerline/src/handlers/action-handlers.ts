/**
 * AHP action handlers: dispatch, authenticate, ping.
 * @module handlers/action-handlers
 */

import type {
  ActionType as ActionTypeT,
  AuthenticateParams,
  AuthenticateResult,
  DispatchActionParams,
} from "@grackle-ai/ahp";
import { ActionType } from "@grackle-ai/ahp";

import { sessionIdFromChannel } from "../channel-codec.js";
import { getSession } from "../session-mgr.js";
import { writeTokens } from "../token-writer.js";

/** Route a `dispatchAction` notification to the session's input. */
export function handleDispatchAction(params: DispatchActionParams): void {
  const sessionId = sessionIdFromChannel(params.channel);
  if (sessionId === undefined) {
    return;
  }
  const session = getSession(sessionId);
  if (session === undefined) {
    return;
  }
  if ((params.action as { type: ActionTypeT }).type === ActionType.SessionTurnStarted) {
    const a = params.action as { message: { text: string } };
    session.sendInput(a.message.text);
  }
}

/** Parse a Grackle-encoded authenticate request and deliver the credential. */
export async function handleAuthenticate(
  params: AuthenticateParams,
): Promise<AuthenticateResult | { _error: string }> {
  const match = /^grackle:\/\/provider\/([^/]+)\/(.+)$/.exec(params.resource);
  if (match === null) {
    return { _error: `Unrecognized authenticate resource: ${params.resource}` };
  }
  const [, , name] = match;
  let parsed: { type: string; envVar?: string; filePath?: string; value: string };
  try {
    parsed = JSON.parse(params.token) as typeof parsed;
  } catch {
    return { _error: "authenticate.token must be JSON-encoded credential" };
  }
  await writeTokens([
    {
      name: name!,
      type: parsed.type,
      envVar: parsed.envVar ?? "",
      filePath: parsed.filePath ?? "",
      value: parsed.value,
    },
  ]);
  return {};
}
