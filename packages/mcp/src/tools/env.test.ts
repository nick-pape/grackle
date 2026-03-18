import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { envTools } from "./env.js";

type GrackleClient = Client<typeof grackle.Grackle>;

/** Helper to find a tool definition by name. */
const getTool = (name: string) => envTools.find((t) => t.name === name)!;

/** Create a mock Grackle client with all env-related methods stubbed. */
function createMockClient(): GrackleClient {
  return {
    listEnvironments: vi.fn(),
    addEnvironment: vi.fn(),
    provisionEnvironment: vi.fn(),
    stopEnvironment: vi.fn(),
    destroyEnvironment: vi.fn(),
    removeEnvironment: vi.fn(),
  } as unknown as GrackleClient;
}

describe("env_list", () => {
  /** Should return mapped environment summaries on success. */
  test("happy path returns environment list", async () => {
    const mockClient = createMockClient();
    (mockClient.listEnvironments as ReturnType<typeof vi.fn>).mockResolvedValue({
      environments: [
        {
          id: "env-1",
          displayName: "Dev Box",
          adapterType: "ssh",
          status: "running",
        },
      ],
    });

    const result = await getTool("env_list").handler({}, mockClient);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toEqual([
      {
        id: "env-1",
        displayName: "Dev Box",
        adapterType: "ssh",
        status: "running",
      },
    ]);
    expect(result.isError).toBeUndefined();
  });

  /** Should return a structured error when the gRPC call fails with ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.listEnvironments as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("env_list").handler({}, mockClient);
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("env_add", () => {
  /** Should JSON.stringify adapterConfig. */
  test("happy path stringifies adapterConfig", async () => {
    const mockClient = createMockClient();
    (mockClient.addEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "env-2",
      displayName: "My Env",
    });

    const result = await getTool("env_add").handler(
      {
        displayName: "My Env",
        adapterType: "codespace",
        adapterConfig: { owner: "octocat", repo: "hello" },
      },
      mockClient,
    );

    expect(mockClient.addEnvironment).toHaveBeenCalledWith({
      displayName: "My Env",
      adapterType: "codespace",
      adapterConfig: JSON.stringify({ owner: "octocat", repo: "hello" }),
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("env-2");
    expect(result.isError).toBeUndefined();
  });

  /** Should pass empty string for adapterConfig when not provided. */
  test("omitted adapterConfig sends empty string", async () => {
    const mockClient = createMockClient();
    (mockClient.addEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "env-3" });

    await getTool("env_add").handler(
      { displayName: "Plain", adapterType: "local" },
      mockClient,
    );

    expect(mockClient.addEnvironment).toHaveBeenCalledWith({
      displayName: "Plain",
      adapterType: "local",
      adapterConfig: "",
    });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.addEnvironment as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("already exists", Code.AlreadyExists),
    );

    const result = await getTool("env_add").handler(
      { displayName: "Dup", adapterType: "ssh" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("ALREADY_EXISTS");
  });
});

describe("env_provision", () => {
  /** Should collect streaming events and return finalStatus success. */
  test("happy path collects stream events", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      yield { stage: "init", message: "Starting", progress: 0 };
      yield { stage: "install", message: "Installing agent", progress: 50 };
      yield { stage: "done", message: "Complete", progress: 100 };
    })();
    (mockClient.provisionEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("env_provision").handler(
      { environmentId: "env-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.finalStatus).toBe("success");
    expect(parsed.events).toHaveLength(3);
    expect(parsed.events[0]).toEqual({ stage: "init", message: "Starting", progress: 0 });
    expect(parsed.events[2]).toEqual({ stage: "done", message: "Complete", progress: 100 });
    expect(result.isError).toBeUndefined();
  });

  /** Should return structured error on ConnectError during streaming. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      yield { stage: "init", message: "Starting", progress: 0 };
      throw new ConnectError("env not found", Code.NotFound);
    })();
    (mockClient.provisionEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("env_provision").handler(
      { environmentId: "env-missing" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.code).toBe("NOT_FOUND");
  });

  /** Should wrap non-ConnectError with collected events and finalStatus error. */
  test("non-ConnectError wraps with collected events", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      yield { stage: "init", message: "Starting", progress: 0 };
      throw new Error("unexpected failure");
    })();
    (mockClient.provisionEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("env_provision").handler(
      { environmentId: "env-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.finalStatus).toBe("error");
    expect(parsed.error).toBe("unexpected failure");
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].stage).toBe("init");
  });
});

describe("env_stop", () => {
  /** Should call stopEnvironment and return success. */
  test("happy path returns success", async () => {
    const mockClient = createMockClient();
    (mockClient.stopEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("env_stop").handler(
      { environmentId: "env-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(mockClient.stopEnvironment).toHaveBeenCalledWith({ id: "env-1" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.stopEnvironment as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("precondition failed", Code.FailedPrecondition),
    );

    const result = await getTool("env_stop").handler(
      { environmentId: "env-1" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("FAILED_PRECONDITION");
  });
});

describe("env_destroy", () => {
  /** Should call destroyEnvironment and return success. */
  test("happy path returns success", async () => {
    const mockClient = createMockClient();
    (mockClient.destroyEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("env_destroy").handler(
      { environmentId: "env-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(mockClient.destroyEnvironment).toHaveBeenCalledWith({ id: "env-1" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.destroyEnvironment as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("internal", Code.Internal),
    );

    const result = await getTool("env_destroy").handler(
      { environmentId: "env-1" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("env_remove", () => {
  /** Should call removeEnvironment and return success. */
  test("happy path returns success", async () => {
    const mockClient = createMockClient();
    (mockClient.removeEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("env_remove").handler(
      { environmentId: "env-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(mockClient.removeEnvironment).toHaveBeenCalledWith({ id: "env-1" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.removeEnvironment as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("precondition", Code.FailedPrecondition),
    );

    const result = await getTool("env_remove").handler(
      { environmentId: "env-1" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("FAILED_PRECONDITION");
  });
});

describe("env_wake", () => {
  /** Should collect streaming events and return finalStatus success. */
  test("happy path collects stream events", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      yield { stage: "wake", message: "Waking up", progress: 0 };
      yield { stage: "done", message: "Ready", progress: 100 };
    })();
    (mockClient.provisionEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("env_wake").handler(
      { environmentId: "env-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.finalStatus).toBe("success");
    expect(parsed.events).toHaveLength(2);
    expect(result.isError).toBeUndefined();
  });

  /** Should return structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      throw new ConnectError("unavailable", Code.Unavailable);
    })();
    (mockClient.provisionEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("env_wake").handler(
      { environmentId: "env-1" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("UNAVAILABLE");
  });

  /** Should wrap non-ConnectError with collected events and finalStatus error. */
  test("non-ConnectError wraps with collected events", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      yield { stage: "wake", message: "Waking", progress: 10 };
      throw new Error("connection lost");
    })();
    (mockClient.provisionEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("env_wake").handler(
      { environmentId: "env-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.finalStatus).toBe("error");
    expect(parsed.error).toBe("connection lost");
    expect(parsed.events).toHaveLength(1);
  });
});
