/**
 * AHP reducer conformance test — verifies that the vendored AHP reducers
 * correctly process a subset of the upstream test-cases/reducers fixtures.
 *
 * The full 156-fixture corpus lives under src/vendor/ahp/test-cases/reducers/
 * and is used here as a smoke-check: a single fixture exercises the session
 * reducer pipeline end-to-end.
 *
 * @module reducer-conformance
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { sessionReducer } from "./index.js";

// Load the first fixture: 003-session-ready.json
const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "vendor",
  "ahp",
  "test-cases",
  "reducers",
);

describe("AHP reducer conformance", () => {
  it("003-session-ready: initial state becomes ready", () => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDir, "003-session-ready.json"), "utf-8"),
    );
    const initialState = {
      summary: fixture.initial.summary,
      lifecycle: fixture.initial.lifecycle,
      turns: [],
    };

    const action = fixture.actions[0];
    const result = sessionReducer(initialState, action);
    expect(result.lifecycle).toBe("ready");
  });

  it("006-turnstarted-with-queuedmessageid: removes queued msg and sets activeTurn", () => {
    const fixture = JSON.parse(
      readFileSync(
        join(
          fixturesDir,
          "006-turnstarted-with-queuedmessageid-removes-from-queuedmessages.json",
        ),
        "utf-8",
      ),
    );
    const initialState = JSON.parse(JSON.stringify(fixture.initial));

    const action = fixture.actions[0];
    const result = sessionReducer(initialState, action);

    expect(result.activeTurn).toBeDefined();
    expect(result.activeTurn.id).toBe(action.turnId);
    expect(result.queuedMessages.length).toBe(1);
    expect(result.queuedMessages[0].id).toBe("q-2");
  });
});
