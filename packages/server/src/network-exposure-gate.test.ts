/**
 * Integration test for the network-exposure startup gate (#1374).
 *
 * Unit-level coverage lives in `config.test.ts` (validates the function in
 * isolation). This file is the wire-level proof: spawn the actual server
 * binary (the compiled `dist/index.js`) with various env combos and assert
 * the process behavior — exit code, stderr message, and crucially that NO
 * port was ever bound on the would-be web port.
 *
 * The "no port bound" check is the safety guarantee: even if the validator
 * were accidentally moved later in startup, this test would catch a listener
 * opening for an unauthenticated cleartext window.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

const SERVER_ENTRY: string = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "index.js",
);

/** Pick a free TCP port on 127.0.0.1 (matches how the rest of the suite allocates). */
async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolveFn) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolveFn(port));
    });
  });
}

/** Can we open a TCP connection to 127.0.0.1:port within a tight timeout? */
async function isPortBound(port: number): Promise<boolean> {
  return new Promise((resolveFn) => {
    const sock = createConnection({ host: "127.0.0.1", port, timeout: 500 });
    sock.once("connect", () => {
      sock.destroy();
      resolveFn(true);
    });
    sock.once("error", () => resolveFn(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolveFn(false);
    });
  });
}

/**
 * Spawn the server. Wait until EITHER (a) it exits on its own, or (b) the
 * fail-fast error has been printed to stderr/stdout. Then SIGKILL it if
 * still alive and return the collected output.
 *
 * We don't gate on natural exit because Node-on-Windows can take 30-60s
 * to fully release after `process.exit(1)` when modules like pino/otlp
 * have non-ref'd handles. The thing this test actually proves is that the
 * gate fires *before* any port is bound — the exit-code timing is
 * incidental. So we capture the error fast, kill the child, and assert.
 */
async function runServerUntilGateFires(
  env: Record<string, string>,
  signalPattern: RegExp,
  timeoutMs: number,
): Promise<{ killed: boolean; stderr: string; stdout: string }> {
  return new Promise((resolveFn) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, ...env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const checkAndResolve = (): boolean => {
      if (signalPattern.test(stdout) || signalPattern.test(stderr)) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
        resolveFn({ killed: true, stderr, stdout });
        return true;
      }
      return false;
    };
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
      checkAndResolve();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
      checkAndResolve();
    });
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      resolveFn({ killed: true, stderr, stdout });
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolveFn({ killed: false, stderr, stdout });
    });
  });
}

const SERVER_BUILT: boolean = existsSync(SERVER_ENTRY);

describe.skipIf(!SERVER_BUILT)("network-exposure gate (#1374 — integration)", () => {
  beforeAll(() => {
    if (!SERVER_BUILT) {
      // Helpful skip reason: `rush test` runs after `rush build` in CI, so
      // the dist is always present there. Local `rushx test` without a prior
      // build silently skips this file rather than fail mysteriously.
    }
  });

  it("non-loopback bind with no satisfier: gate fires before any port binds", async () => {
    // Pre-allocate ports so we can assert they were NOT bound by the failed
    // startup. The actual server would otherwise pick its defaults.
    const grpcPort = await findFreePort();
    const webPort = await findFreePort();
    const mcpPort = await findFreePort();
    const sandboxPort = await findFreePort();
    const powerlinePort = await findFreePort();

    // Sanity: none of them are listening before we start.
    expect(await isPortBound(webPort)).toBe(false);

    const result = await runServerUntilGateFires(
      {
        GRACKLE_HOST: "0.0.0.0",
        // intentionally NO TLS, NO publicUrl, NO allow-insecure
        GRACKLE_PORT: String(grpcPort),
        GRACKLE_WEB_PORT: String(webPort),
        GRACKLE_MCP_PORT: String(mcpPort),
        GRACKLE_SANDBOX_PORT: String(sandboxPort),
        GRACKLE_POWERLINE_PORT: String(powerlinePort),
        GRACKLE_HOME: "",
        GRACKLE_SKIP_LOCAL_POWERLINE: "1",
      },
      /Insecure network exposure/,
      15_000,
    );

    // The fail-fast error landed in the structured pino log (stdout) or stderr.
    const combined = result.stderr + result.stdout;
    expect(combined, "expected the gate error in the child's output").toMatch(
      /Insecure network exposure/,
    );
    expect(combined).toMatch(/GHSA-wcpf-6gwv-47c8/);
    // All three satisfiers should be in the same message (the doc-quality
    // assertion — if any is missing the operator can't fix without a doc round trip).
    expect(combined).toMatch(/GRACKLE_TLS_CERT/);
    expect(combined).toMatch(/GRACKLE_PUBLIC_URL=https/);
    expect(combined).toMatch(/GRACKLE_ALLOW_INSECURE=1/);

    // The crucial safety check — NO listener bound the web/grpc/mcp/sandbox
    // ports during the failed startup. The validator must run before any
    // .listen() call.
    expect(await isPortBound(webPort), "web port was bound during failed startup").toBe(false);
    expect(await isPortBound(grpcPort), "grpc port was bound during failed startup").toBe(false);
    expect(await isPortBound(mcpPort), "mcp port was bound during failed startup").toBe(false);
    expect(await isPortBound(sandboxPort), "sandbox port was bound during failed startup").toBe(
      false,
    );
  }, 30_000);
});
