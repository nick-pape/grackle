/**
 * Unit tests for the AHP resource-bridge gRPC handlers (#1395).
 *
 * Covers: read/list happy paths + error mapping, the ref-counted watch registry
 * (shared subscription, last-ref close), `resource.changed` emission, and the
 * idempotent unwatch of an unknown handle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@grackle-ai/adapter-sdk";
import type {
  PowerLineConnection,
  ResourceChange,
  ResourceWatchListener,
  ResourceWatchSubscription,
} from "@grackle-ai/adapter-sdk";

// ── Mock @grackle-ai/core (the only heavy dep these handlers touch) ──
const getConnection = vi.fn<(environmentId: string) => PowerLineConnection | undefined>();
const emit = vi.fn();

vi.mock("@grackle-ai/core", () => ({
  adapterManager: { getConnection: (id: string) => getConnection(id) },
  emit: (type: string, payload: unknown) => emit(type, payload),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  readResource,
  listResource,
  watchResource,
  unwatchResource,
  __resetResourceWatchesForTesting,
} from "./resource-handlers.js";

/** Build a fake PowerLineConnection whose transport is a set of vi spies. */
function makeConnection(
  overrides: Partial<PowerLineConnection["transport"]> = {},
): PowerLineConnection {
  const transport = {
    resourceRead: vi.fn(),
    resourceList: vi.fn(),
    createResourceWatch: vi.fn(),
    ...overrides,
  } as unknown as PowerLineConnection["transport"];
  return { environmentId: "env-1", port: 0, transport } as unknown as PowerLineConnection;
}

beforeEach(() => {
  getConnection.mockReset();
  emit.mockReset();
});

afterEach(async () => {
  await __resetResourceWatchesForTesting();
});

describe("readResource", () => {
  it("returns mapped content from the transport", async () => {
    const conn = makeConnection({
      resourceRead: vi.fn(async () => ({
        data: "# hi",
        encoding: "utf-8",
        contentType: "text/markdown",
      })),
    });
    getConnection.mockReturnValue(conn);

    const res = await readResource({
      environmentId: "env-1",
      uri: "file:///w/doc.md",
      encoding: "",
    } as never);
    expect(res.data).toBe("# hi");
    expect(res.encoding).toBe("utf-8");
    expect(res.contentType).toBe("text/markdown");
    // encoding "" → undefined on the wire.
    expect(conn.transport.resourceRead).toHaveBeenCalledWith("file:///w/doc.md", undefined);
  });

  it("throws FailedPrecondition when the environment is not connected", async () => {
    getConnection.mockReturnValue(undefined);
    await expect(
      readResource({ environmentId: "gone", uri: "file:///x", encoding: "" } as never),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
  });

  it("maps AHP NotFound to gRPC NotFound", async () => {
    const conn = makeConnection({
      resourceRead: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { code: AhpErrorCodes.NotFound, message: "no such file" };
      }),
    });
    getConnection.mockReturnValue(conn);
    await expect(
      readResource({ environmentId: "env-1", uri: "file:///x", encoding: "" } as never),
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it("maps AHP PermissionDenied to gRPC PermissionDenied", async () => {
    const conn = makeConnection({
      resourceRead: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { code: AhpErrorCodes.PermissionDenied, message: "outside sandbox" };
      }),
    });
    getConnection.mockReturnValue(conn);
    await expect(
      readResource({ environmentId: "env-1", uri: "file:///../etc", encoding: "" } as never),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it("maps InvalidParams to gRPC InvalidArgument", async () => {
    const conn = makeConnection({
      resourceRead: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { code: JsonRpcErrorCodes.InvalidParams, message: "bad uri" };
      }),
    });
    getConnection.mockReturnValue(conn);
    await expect(
      readResource({ environmentId: "env-1", uri: "notauri", encoding: "" } as never),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("rejects an unsupported encoding before calling the wire", async () => {
    const conn = makeConnection();
    getConnection.mockReturnValue(conn);
    await expect(
      readResource({ environmentId: "env-1", uri: "file:///x", encoding: "rot13" } as never),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(conn.transport.resourceRead).not.toHaveBeenCalled();
  });
});

describe("listResource", () => {
  it("maps directory entries", async () => {
    const conn = makeConnection({
      resourceList: vi.fn(async () => ({
        entries: [
          { name: "a.md", type: "file" },
          { name: "sub", type: "directory" },
        ],
      })),
    });
    getConnection.mockReturnValue(conn);
    const res = await listResource({ environmentId: "env-1", uri: "file:///w" } as never);
    expect(res.entries.map((e) => `${e.name}:${e.type}`)).toEqual(["a.md:file", "sub:directory"]);
  });
});

describe("watch registry", () => {
  it("shares one subscription across watch ids and closes on the last unwatch", async () => {
    let captured: ResourceWatchListener | undefined;
    const close = vi.fn(async () => {});
    const createResourceWatch = vi.fn(
      async (_opts, onChange: ResourceWatchListener): Promise<ResourceWatchSubscription> => {
        captured = onChange;
        return { channel: "ahp-resource-watch:/w1", close };
      },
    );
    getConnection.mockReturnValue(makeConnection({ createResourceWatch }));

    const a = await watchResource({
      environmentId: "env-1",
      uri: "file:///w/doc.md",
      recursive: false,
    } as never);
    const b = await watchResource({
      environmentId: "env-1",
      uri: "file:///w/doc.md",
      recursive: false,
    } as never);

    // One underlying wire watch, two distinct handles.
    expect(createResourceWatch).toHaveBeenCalledTimes(1);
    expect(a.watchId).not.toBe(b.watchId);

    // A change batch emits a `resource.changed` domain event.
    const changes: ResourceChange[] = [
      { uri: "file:///w/doc.md", type: "updated" } as ResourceChange,
    ];
    captured?.(changes);
    expect(emit).toHaveBeenCalledWith("resource.changed", {
      environmentId: "env-1",
      uri: "file:///w/doc.md",
      changes: [{ uri: "file:///w/doc.md", type: "updated" }],
    });

    // First unwatch keeps the watch alive; second closes it.
    await unwatchResource({ watchId: a.watchId } as never);
    expect(close).not.toHaveBeenCalled();
    await unwatchResource({ watchId: b.watchId } as never);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("treats different recursive flags as distinct watches", async () => {
    let n = 0;
    const createResourceWatch = vi.fn(
      async (): Promise<ResourceWatchSubscription> => ({
        channel: `ahp-resource-watch:/w${(n += 1)}`,
        close: vi.fn(async () => {}),
      }),
    );
    getConnection.mockReturnValue(makeConnection({ createResourceWatch }));
    await watchResource({ environmentId: "env-1", uri: "file:///w", recursive: false } as never);
    await watchResource({ environmentId: "env-1", uri: "file:///w", recursive: true } as never);
    expect(createResourceWatch).toHaveBeenCalledTimes(2);
  });

  it("unwatch of an unknown handle is a no-op", async () => {
    await expect(unwatchResource({ watchId: "nope" } as never)).resolves.toBeDefined();
  });

  it("watchResource throws FailedPrecondition when the environment is not connected", async () => {
    getConnection.mockReturnValue(undefined);
    await expect(
      watchResource({ environmentId: "gone", uri: "file:///x", recursive: false } as never),
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
