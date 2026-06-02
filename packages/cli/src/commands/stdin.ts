import type { Readable } from "node:stream";

/**
 * Read the entire contents of a Readable stream as a UTF-8 string and trim
 * trailing/leading whitespace.
 *
 * Used to consume `process.stdin` when the CLI is invoked in a non-TTY
 * context (CI pipelines, shell pipes), where prompting via `readline.question`
 * would hang forever waiting for input that will never arrive.
 *
 * @param stream - The stream to drain (typically `process.stdin`).
 * @returns The trimmed concatenation of every chunk emitted before EOF.
 */
export async function readStdinAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}
