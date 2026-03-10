import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, sendWsAndWaitForError } from "./helpers.js";

test.describe("Token Management (WebSocket)", () => {
  test("list_tokens returns a valid token array", async ({ appPage }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      { type: "list_tokens" },
      "tokens",
    );

    expect(response.payload?.tokens).toBeDefined();
    expect(Array.isArray(response.payload?.tokens)).toBe(true);
  });

  test("set_token and list_tokens round-trip", async ({ appPage }) => {
    const page = appPage;

    // Set a token via WS
    await sendWsAndWaitFor(
      page,
      {
        type: "set_token",
        payload: {
          name: "test-token-rt",
          value: "secret-value-123",
          tokenType: "env_var",
          envVar: "TEST_TOKEN_RT",
          filePath: "",
        },
      },
      "token_changed",
    );

    // List tokens and verify it's present
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_tokens" },
      "tokens",
    );

    const tokens = listResponse.payload?.tokens as Array<{
      name: string;
      tokenType: string;
      envVar: string;
    }>;
    const found = tokens.find((t) => t.name === "test-token-rt");
    expect(found).toBeDefined();
    expect(found?.tokenType).toBe("env_var");
    expect(found?.envVar).toBe("TEST_TOKEN_RT");

    // Clean up
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "test-token-rt" } },
      "token_changed",
    );
  });

  test("set_token with file type stores filePath", async ({ appPage }) => {
    const page = appPage;

    await sendWsAndWaitFor(
      page,
      {
        type: "set_token",
        payload: {
          name: "test-file-token",
          value: "file-secret",
          tokenType: "file",
          envVar: "",
          filePath: "/home/user/.secret",
        },
      },
      "token_changed",
    );

    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_tokens" },
      "tokens",
    );

    const tokens = listResponse.payload?.tokens as Array<{
      name: string;
      tokenType: string;
      filePath: string;
    }>;
    const found = tokens.find((t) => t.name === "test-file-token");
    expect(found).toBeDefined();
    expect(found?.tokenType).toBe("file");
    expect(found?.filePath).toBe("/home/user/.secret");

    // Clean up
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "test-file-token" } },
      "token_changed",
    );
  });

  test("delete_token removes token from list", async ({ appPage }) => {
    const page = appPage;

    // Create token
    await sendWsAndWaitFor(
      page,
      {
        type: "set_token",
        payload: {
          name: "test-delete-me",
          value: "to-be-deleted",
          tokenType: "env_var",
          envVar: "DELETE_ME",
          filePath: "",
        },
      },
      "token_changed",
    );

    // Verify it exists
    let listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_tokens" },
      "tokens",
    );
    let tokens = listResponse.payload?.tokens as Array<{ name: string }>;
    expect(tokens.find((t) => t.name === "test-delete-me")).toBeDefined();

    // Delete it
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "test-delete-me" } },
      "token_changed",
    );

    // Verify it's gone
    listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_tokens" },
      "tokens",
    );
    tokens = listResponse.payload?.tokens as Array<{ name: string }>;
    expect(tokens.find((t) => t.name === "test-delete-me")).toBeUndefined();
  });

  test("set_token without name returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitForError(page, {
      type: "set_token",
      payload: { name: "", value: "something", tokenType: "env_var" },
    });

    expect(error.payload?.message).toContain("required");
  });

  test("set_token without value returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitForError(page, {
      type: "set_token",
      payload: { name: "no-value-token", value: "", tokenType: "env_var" },
    });

    expect(error.payload?.message).toContain("required");
  });

  test("delete_token without name returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitForError(page, {
      type: "delete_token",
      payload: { name: "" },
    });

    expect(error.payload?.message).toContain("required");
  });

  test("set_token overwrites existing token", async ({ appPage }) => {
    const page = appPage;

    // Create initial token
    await sendWsAndWaitFor(
      page,
      {
        type: "set_token",
        payload: {
          name: "test-overwrite",
          value: "original-value",
          tokenType: "env_var",
          envVar: "ORIGINAL_VAR",
          filePath: "",
        },
      },
      "token_changed",
    );

    // Overwrite with new env var name
    await sendWsAndWaitFor(
      page,
      {
        type: "set_token",
        payload: {
          name: "test-overwrite",
          value: "updated-value",
          tokenType: "env_var",
          envVar: "UPDATED_VAR",
          filePath: "",
        },
      },
      "token_changed",
    );

    // Verify updated
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_tokens" },
      "tokens",
    );
    const tokens = listResponse.payload?.tokens as Array<{
      name: string;
      envVar: string;
    }>;
    const found = tokens.find((t) => t.name === "test-overwrite");
    expect(found?.envVar).toBe("UPDATED_VAR");

    // Only one entry with that name
    const count = tokens.filter((t) => t.name === "test-overwrite").length;
    expect(count).toBe(1);

    // Clean up
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "test-overwrite" } },
      "token_changed",
    );
  });

  test("token values are not exposed in list_tokens response", async ({ appPage }) => {
    const page = appPage;

    await sendWsAndWaitFor(
      page,
      {
        type: "set_token",
        payload: {
          name: "test-no-value",
          value: "super-secret",
          tokenType: "env_var",
          envVar: "SECRET_VAR",
          filePath: "",
        },
      },
      "token_changed",
    );

    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_tokens" },
      "tokens",
    );

    const tokens = listResponse.payload?.tokens as Array<Record<string, unknown>>;
    const found = tokens.find((t) => t.name === "test-no-value");
    expect(found).toBeDefined();
    // Value must not be present in the response
    expect(found?.value).toBeUndefined();

    // Clean up
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "test-no-value" } },
      "token_changed",
    );
  });

  test("delete_token for non-existent name succeeds silently", async ({ appPage }) => {
    const page = appPage;

    // Deleting a token that doesn't exist should not error
    const response = await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "nonexistent-token-xyz" } },
      "token_changed",
    );

    expect(response.type).toBe("token_changed");
  });
});
