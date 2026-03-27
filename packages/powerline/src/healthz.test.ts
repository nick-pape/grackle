import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http2 from "node:http2";
import net from "node:net";
import { execFile, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const ENTRY_POINT = join(import.meta.dirname, "..", "dist", "index.js");

/** Find a free ephemeral port. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Wait for a port to accept connections. */
function waitForPort(port: number, timeoutMs: number = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function tryConnect(): void {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for port ${port}`));
        return;
      }
      const sock = net.createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => { sock.destroy(); setTimeout(tryConnect, 200); });
    }
    tryConnect();
  });
}

/** Make an HTTP/2 request to the given port and path. */
function request(
  port: number,
  path: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`http://127.0.0.1:${port}`);
    client.on("error", reject);

    const req = client.request({ ":method": "GET", ":path": path });
    let body = "";
    let status = 0;
    const headers: Record<string, string> = {};

    req.on("response", (hdrs) => {
      status = hdrs[":status"] as number;
      for (const [key, value] of Object.entries(hdrs)) {
        if (!key.startsWith(":") && typeof value === "string") {
          headers[key] = value;
        }
      }
    });
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      client.close();
      resolve({ status, headers, body });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("PowerLine /healthz endpoint", () => {
  let port: number;
  let child: ChildProcess;

  beforeAll(async () => {
    port = await findFreePort();
    child = execFile(process.execPath, [ENTRY_POINT, "--no-auth", "--port", String(port)], {
      env: { ...process.env },
    });
    await waitForPort(port);
  }, 15_000);

  afterAll(() => {
    child?.kill();
  });

  it("returns 200 with status ok", async () => {
    const res = await request(port, "/healthz");

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("returns Cache-Control: no-store", async () => {
    const res = await request(port, "/healthz");

    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
